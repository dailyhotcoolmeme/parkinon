import ExpoModulesCore
import AVFoundation
import AudioToolbox

/**
 * AlarmSoundModule — 가족 목소리 알림음(iOS) 설치 모듈.
 *
 * 목적: 앱이 다운로드한 녹음(m4a/AAC)을 iOS 알림음 규격(caf, kAudioFormatAppleIMA4,
 *       44100Hz, mono, ≤30초)으로 기기에서 직접 변환해
 *       Library/Sounds/<name> 에 설치한다.
 *       이후 푸시 payload 의 sound 필드에 <name> 을 지정하면 그 목소리로 알림이 울린다.
 *
 * iOS 알림음 제약(반드시 지킬 것):
 *   - 위치: <App Container>/Library/Sounds/
 *   - 포맷: Linear PCM, MA4(IMA/ADPCM), µ-law, a-law 만 허용 → AAC/m4a 그대로는 불가.
 *   - 길이: 30초 이하(초과 시 무음 처리). 여기서는 앞 30초만 잘라 변환.
 *
 * 변환 방식: AudioToolbox 의 ExtAudioFile.
 *   - 입력(.m4a) 을 ExtAudioFileOpenURL 로 열고,
 *   - kExtAudioFileProperty_ClientDataFormat 을 44100Hz/mono/Int16 PCM 으로 설정(디코드 결과),
 *   - 출력 파일을 kAudioFormatAppleIMA4 / 44100 / mono 의 .caf 로 생성하고,
 *     클라이언트 포맷을 동일 PCM 으로 설정하면 ExtAudioFile 이 PCM→IMA4 인코딩을 담당한다.
 *   - PCM 버퍼로 읽어 그대로 write → 30초 분량(=44100*30 프레임)에 도달하면 중단.
 */
public class AlarmSoundModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AlarmSound")

    AsyncFunction("installSound") { (sourcePath: String, name: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let installed = try AlarmSoundConverter.installSound(sourcePath: sourcePath, name: name)
          promise.resolve(installed)
        } catch {
          promise.reject("ERR_INSTALL_SOUND", error.localizedDescription)
        }
      }
    }

    AsyncFunction("removeSound") { (name: String, promise: Promise) in
      do {
        try AlarmSoundConverter.removeSound(name: name)
        promise.resolve(nil)
      } catch {
        promise.reject("ERR_REMOVE_SOUND", error.localizedDescription)
      }
    }

    AsyncFunction("listSounds") { (promise: Promise) in
      do {
        let names = try AlarmSoundConverter.listSounds()
        promise.resolve(names)
      } catch {
        promise.reject("ERR_LIST_SOUNDS", error.localizedDescription)
      }
    }
  }
}

enum AlarmSoundError: Error, LocalizedError {
  case sourceNotFound(String)
  case openInputFailed(OSStatus)
  case createOutputFailed(OSStatus)
  case setClientFormatFailed(OSStatus)
  case readFailed(OSStatus)
  case writeFailed(OSStatus)
  case soundsDirFailed(String)

  var errorDescription: String? {
    switch self {
    case .sourceNotFound(let p): return "source audio not found: \(p)"
    case .openInputFailed(let s): return "ExtAudioFileOpenURL failed: \(s)"
    case .createOutputFailed(let s): return "ExtAudioFileCreateWithURL failed: \(s)"
    case .setClientFormatFailed(let s): return "set ClientDataFormat failed: \(s)"
    case .readFailed(let s): return "ExtAudioFileRead failed: \(s)"
    case .writeFailed(let s): return "ExtAudioFileWrite failed: \(s)"
    case .soundsDirFailed(let m): return "Library/Sounds error: \(m)"
    }
  }
}

struct AlarmSoundConverter {
  static let sampleRate: Float64 = 44100.0
  static let maxSeconds: Float64 = 30.0

  /// Library/Sounds 디렉터리 URL(없으면 생성).
  static func soundsDirectory() throws -> URL {
    guard let libDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else {
      throw AlarmSoundError.soundsDirFailed("libraryDirectory not found")
    }
    let soundsDir = libDir.appendingPathComponent("Sounds", isDirectory: true)
    if !FileManager.default.fileExists(atPath: soundsDir.path) {
      try FileManager.default.createDirectory(at: soundsDir, withIntermediateDirectories: true)
    }
    return soundsDir
  }

  /// 입력 경로 문자열(file:// 또는 일반 경로)을 URL 로 정규화.
  static func normalizeSourceURL(_ sourcePath: String) -> URL {
    if sourcePath.hasPrefix("file://") {
      return URL(string: sourcePath) ?? URL(fileURLWithPath: sourcePath)
    }
    return URL(fileURLWithPath: sourcePath)
  }

  /// m4a → IMA4 caf 변환 후 Library/Sounds/<name> 설치. 설치된 파일명 반환.
  static func installSound(sourcePath: String, name: String) throws -> String {
    let srcURL = normalizeSourceURL(sourcePath)
    guard FileManager.default.fileExists(atPath: srcURL.path) else {
      throw AlarmSoundError.sourceNotFound(srcURL.path)
    }

    let soundsDir = try soundsDirectory()
    let destURL = soundsDir.appendingPathComponent(name)

    // 기존 동일 파일이 있으면 덮어쓰기(재변환).
    if FileManager.default.fileExists(atPath: destURL.path) {
      try? FileManager.default.removeItem(at: destURL)
    }

    // 임시 파일에 먼저 쓰고 성공 시 원자적 이동(부분 파일이 알림음으로 남지 않게).
    let tmpURL = soundsDir.appendingPathComponent(".tmp_\(UUID().uuidString)_\(name)")
    if FileManager.default.fileExists(atPath: tmpURL.path) {
      try? FileManager.default.removeItem(at: tmpURL)
    }

    do {
      try convertToIMA4Caf(input: srcURL, output: tmpURL)
    } catch {
      try? FileManager.default.removeItem(at: tmpURL)
      throw error
    }

    try FileManager.default.moveItem(at: tmpURL, to: destURL)
    return name
  }

  static func removeSound(name: String) throws {
    let soundsDir = try soundsDirectory()
    let url = soundsDir.appendingPathComponent(name)
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  static func listSounds() throws -> [String] {
    let soundsDir = try soundsDirectory()
    let items = try FileManager.default.contentsOfDirectory(atPath: soundsDir.path)
    // 숨김 임시 파일 제외.
    return items.filter { !$0.hasPrefix(".") }
  }

  /// 핵심 변환: ExtAudioFile 로 input(.m4a/AAC 등) → output(.caf, IMA4, 44100, mono, ≤30s).
  static func convertToIMA4Caf(input: URL, output: URL) throws {
    // 1) 입력 열기
    var inputFile: ExtAudioFileRef?
    var status = ExtAudioFileOpenURL(input as CFURL, &inputFile)
    guard status == noErr, let inFile = inputFile else {
      throw AlarmSoundError.openInputFailed(status)
    }
    defer { ExtAudioFileDispose(inFile) }

    // 2) 클라이언트(중간) 포맷 = 44100Hz mono Int16 PCM (디코드 결과를 이 형태로 받음)
    var clientFormat = AudioStreamBasicDescription()
    clientFormat.mSampleRate = sampleRate
    clientFormat.mFormatID = kAudioFormatLinearPCM
    clientFormat.mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked
    clientFormat.mFramesPerPacket = 1
    clientFormat.mChannelsPerFrame = 1
    clientFormat.mBitsPerChannel = 16
    clientFormat.mBytesPerFrame = 2  // 16bit * 1ch
    clientFormat.mBytesPerPacket = 2

    let clientSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    status = ExtAudioFileSetProperty(
      inFile,
      kExtAudioFileProperty_ClientDataFormat,
      clientSize,
      &clientFormat
    )
    guard status == noErr else {
      throw AlarmSoundError.setClientFormatFailed(status)
    }

    // 3) 출력 포맷 = IMA4 caf, 44100, mono
    //    IMA4 는 packet 당 64 프레임, packet 크기 34바이트(mono). mBitsPerChannel/mBytesPerFrame 은 0.
    var outputFormat = AudioStreamBasicDescription()
    outputFormat.mSampleRate = sampleRate
    outputFormat.mFormatID = kAudioFormatAppleIMA4
    outputFormat.mFormatFlags = 0
    outputFormat.mFramesPerPacket = 64
    outputFormat.mChannelsPerFrame = 1
    outputFormat.mBitsPerChannel = 0
    outputFormat.mBytesPerFrame = 0
    outputFormat.mBytesPerPacket = 34  // mono IMA4 packet size

    var outputFile: ExtAudioFileRef?
    status = ExtAudioFileCreateWithURL(
      output as CFURL,
      kAudioFileCAFType,
      &outputFormat,
      nil,
      AudioFileFlags.eraseFile.rawValue,
      &outputFile
    )
    guard status == noErr, let outFile = outputFile else {
      throw AlarmSoundError.createOutputFailed(status)
    }
    defer { ExtAudioFileDispose(outFile) }

    // 4) 출력 파일도 같은 클라이언트 포맷(PCM)을 받도록 설정 → ExtAudioFile 이 PCM→IMA4 인코딩 수행
    status = ExtAudioFileSetProperty(
      outFile,
      kExtAudioFileProperty_ClientDataFormat,
      clientSize,
      &clientFormat
    )
    guard status == noErr else {
      throw AlarmSoundError.setClientFormatFailed(status)
    }

    // 5) 30초 캡: 최대 프레임 수
    let maxFrames = Int64(sampleRate * maxSeconds)
    var framesWritten: Int64 = 0

    // 6) 버퍼 단위로 read → write
    let bufferFrameCapacity: UInt32 = 4096
    let bytesPerFrame = Int(clientFormat.mBytesPerFrame)
    let bufferByteSize = Int(bufferFrameCapacity) * bytesPerFrame
    let pcmBuffer = UnsafeMutableRawPointer.allocate(byteCount: bufferByteSize, alignment: MemoryLayout<Int16>.alignment)
    defer { pcmBuffer.deallocate() }

    while framesWritten < maxFrames {
      // 남은 30초 한도 안에서만 읽기
      let remaining = maxFrames - framesWritten
      var framesToRead = bufferFrameCapacity
      if Int64(framesToRead) > remaining {
        framesToRead = UInt32(remaining)
      }

      var abl = AudioBufferList()
      abl.mNumberBuffers = 1
      abl.mBuffers.mNumberChannels = 1
      abl.mBuffers.mDataByteSize = framesToRead * clientFormat.mBytesPerFrame
      abl.mBuffers.mData = pcmBuffer

      var frameCount = framesToRead
      status = ExtAudioFileRead(inFile, &frameCount, &abl)
      guard status == noErr else {
        throw AlarmSoundError.readFailed(status)
      }
      if frameCount == 0 {
        break  // EOF
      }

      status = ExtAudioFileWrite(outFile, frameCount, &abl)
      guard status == noErr else {
        throw AlarmSoundError.writeFailed(status)
      }

      framesWritten += Int64(frameCount)
    }
  }
}
