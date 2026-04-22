import sharp from 'sharp';
import { copyFileSync } from 'fs';

const input = './assets/adaptive-icon.png';
const output = './assets/adaptive-icon-padded.png';

const size = 1024;
const contentSize = Math.round(size * 0.66); // safe zone 66%
const padding = Math.round((size - contentSize) / 2);

console.log(`원본 크기: ${size}x${size}`);
console.log(`콘텐츠 크기(66% safe zone): ${contentSize}x${contentSize}`);
console.log(`패딩: ${padding}px`);

await sharp(input)
  .resize(contentSize, contentSize, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .extend({
    top: padding,
    bottom: size - contentSize - padding,
    left: padding,
    right: size - contentSize - padding,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .toFile(output);

console.log('완료:', output);

// 원본 백업 후 교체
copyFileSync(input, './assets/adaptive-icon-original.png');
copyFileSync(output, input);
console.log('교체 완료: adaptive-icon.png 업데이트됨');
console.log('백업: adaptive-icon-original.png');
