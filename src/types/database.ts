export type UserRole = 'patient' | 'caregiver';
export type ResidenceType = 'together' | 'separate';
export type CaregiverRelation = 'spouse' | 'child' | 'sibling' | 'other';
export type MealTime = 'morning' | 'lunch' | 'dinner' | 'bedtime';
export type TriggeredBy = 'notification' | 'manual';
export type PostType = 'chat' | 'question' | 'info' | 'exercise' | 'cheer';

// 디지털 바이오마커 측정 타입 (docs/digital_biomarker_mvpA_spec.md §8)
export type MeasurementType = 'tap' | 'reaction';
export type MeasurementMedPhase = '30m' | '2h' | 'self_initiated' | 'other';

// ⚠️ AUTO-GENERATED Supabase 타입 (project: avqaflxufyadgzjiojkk)
// 재생성: Supabase MCP generate_typescript_types (2026-06-26)
// CLI 대안: npx supabase gen types typescript --project-id avqaflxufyadgzjiojkk
// 위 enum 별칭(UserRole 등)은 손으로 추가한 헬퍼이므로 재생성 시 보존할 것.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      alarm_sound_prefs: {
        Row: {
          bypass_silent: boolean
          custom_sound_id: string | null
          persistent: boolean
          preset_key: string | null
          sound_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bypass_silent?: boolean
          custom_sound_id?: string | null
          persistent?: boolean
          preset_key?: string | null
          sound_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bypass_silent?: boolean
          custom_sound_id?: string | null
          persistent?: boolean
          preset_key?: string | null
          sound_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alarm_sound_prefs_custom_sound_id_fkey"
            columns: ["custom_sound_id"]
            isOneToOne: false
            referencedRelation: "custom_sounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alarm_sound_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alarm_sound_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      baseline_stats: {
        Row: {
          feature_key: string
          mean: number
          n: number
          sd: number
          updated_at: string
          user_id: string
        }
        Insert: {
          feature_key: string
          mean?: number
          n?: number
          sd?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          feature_key?: string
          mean?: number
          n?: number
          sd?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "baseline_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_likes: {
        Row: {
          comment_id: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          content: string
          created_at: string | null
          hidden: boolean
          hidden_at: string | null
          hidden_reason: string | null
          id: string
          like_count: number | null
          parent_id: string | null
          post_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string | null
          hidden?: boolean
          hidden_at?: string | null
          hidden_reason?: string | null
          id?: string
          like_count?: number | null
          parent_id?: string | null
          post_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string | null
          hidden?: boolean
          hidden_at?: string | null
          hidden_reason?: string | null
          id?: string
          like_count?: number | null
          parent_id?: string | null
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_sounds: {
        Row: {
          created_at: string
          duration_ms: number | null
          group_id: string
          id: string
          label: string | null
          public_url: string | null
          r2_key_android: string | null
          r2_key_caf: string | null
          r2_key_src: string
          recorded_by: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          group_id: string
          id?: string
          label?: string | null
          public_url?: string | null
          r2_key_android?: string | null
          r2_key_caf?: string | null
          r2_key_src: string
          recorded_by: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          group_id?: string
          id?: string
          label?: string | null
          public_url?: string | null
          r2_key_android?: string | null
          r2_key_caf?: string | null
          r2_key_src?: string
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_sounds_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "patient_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_sounds_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_sounds_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      diary_entries: {
        Row: {
          audio_r2_key: string | null
          audio_url: string | null
          author_id: string
          created_at: string
          entry_date: string
          id: string
          media_order: string[] | null
          patient_id: string
          photo_urls: string[]
          text: string | null
          updated_at: string
          video_media_id: string | null
        }
        Insert: {
          audio_r2_key?: string | null
          audio_url?: string | null
          author_id: string
          created_at?: string
          entry_date: string
          id?: string
          media_order?: string[] | null
          patient_id: string
          photo_urls?: string[]
          text?: string | null
          updated_at?: string
          video_media_id?: string | null
        }
        Update: {
          audio_r2_key?: string | null
          audio_url?: string | null
          author_id?: string
          created_at?: string
          entry_date?: string
          id?: string
          media_order?: string[] | null
          patient_id?: string
          photo_urls?: string[]
          text?: string | null
          updated_at?: string
          video_media_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "diary_entries_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diary_entries_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diary_entries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diary_entries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diary_entries_video_media_id_fkey"
            columns: ["video_media_id"]
            isOneToOne: false
            referencedRelation: "media_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      dose_slots: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          legacy_key: string | null
          patient_id: string
          remind_enabled: boolean
          remind_sound_id: string | null
          sort_order: number
          time: string
          track_enabled: boolean
          track_intervals: number[]
          track_sound_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          legacy_key?: string | null
          patient_id: string
          remind_enabled?: boolean
          remind_sound_id?: string | null
          sort_order?: number
          time: string
          track_enabled?: boolean
          track_intervals?: number[]
          track_sound_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          legacy_key?: string | null
          patient_id?: string
          remind_enabled?: boolean
          remind_sound_id?: string | null
          sort_order?: number
          time?: string
          track_enabled?: boolean
          track_intervals?: number[]
          track_sound_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dose_slots_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dose_slots_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      effect_tracking_queue: {
        Row: {
          created_at: string | null
          dose_slot_id: string | null
          id: string
          interval_minutes: number
          meal_time: string | null
          med_log_id: string | null
          patient_id: string
          push_token: string
          send_at: string
          sent_at: string | null
          sound_id: string | null
        }
        Insert: {
          created_at?: string | null
          dose_slot_id?: string | null
          id?: string
          interval_minutes: number
          meal_time?: string | null
          med_log_id?: string | null
          patient_id: string
          push_token: string
          send_at: string
          sent_at?: string | null
          sound_id?: string | null
        }
        Update: {
          created_at?: string | null
          dose_slot_id?: string | null
          id?: string
          interval_minutes?: number
          meal_time?: string | null
          med_log_id?: string | null
          patient_id?: string
          push_token?: string
          send_at?: string
          sent_at?: string | null
          sound_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "effect_tracking_queue_dose_slot_id_fkey"
            columns: ["dose_slot_id"]
            isOneToOne: false
            referencedRelation: "dose_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "effect_tracking_queue_med_log_id_fkey"
            columns: ["med_log_id"]
            isOneToOne: false
            referencedRelation: "med_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "effect_tracking_queue_sound_id_fkey"
            columns: ["sound_id"]
            isOneToOne: false
            referencedRelation: "custom_sounds"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_logs: {
        Row: {
          created_at: string | null
          duration_minutes: number
          exercise_type: string
          id: string
          logged_at: string
          logged_by: string | null
          patient_id: string
        }
        Insert: {
          created_at?: string | null
          duration_minutes: number
          exercise_type: string
          id?: string
          logged_at: string
          logged_by?: string | null
          patient_id: string
        }
        Update: {
          created_at?: string | null
          duration_minutes?: number
          exercise_type?: string
          id?: string
          logged_at?: string
          logged_by?: string | null
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_features: {
        Row: {
          created_at: string
          feature_key: string
          id: string
          measurement_id: string
          value_jsonb: Json | null
          value_numeric: number | null
        }
        Insert: {
          created_at?: string
          feature_key: string
          id?: string
          measurement_id: string
          value_jsonb?: Json | null
          value_numeric?: number | null
        }
        Update: {
          created_at?: string
          feature_key?: string
          id?: string
          measurement_id?: string
          value_jsonb?: Json | null
          value_numeric?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurement_features_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      measurements: {
        Row: {
          context: Json
          created_at: string
          deleted_at: string | null
          ended_at: string | null
          id: string
          med_intake_id: string | null
          med_phase: string
          started_at: string
          type: string
          user_id: string
        }
        Insert: {
          context?: Json
          created_at?: string
          deleted_at?: string | null
          ended_at?: string | null
          id?: string
          med_intake_id?: string | null
          med_phase?: string
          started_at?: string
          type: string
          user_id: string
        }
        Update: {
          context?: Json
          created_at?: string
          deleted_at?: string | null
          ended_at?: string | null
          id?: string
          med_intake_id?: string | null
          med_phase?: string
          started_at?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurements_med_intake_id_fkey"
            columns: ["med_intake_id"]
            isOneToOne: false
            referencedRelation: "med_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      med_logs: {
        Row: {
          created_at: string | null
          dose_slot_id: string | null
          id: string
          logged_by: string | null
          meal_time: string | null
          medication_id: string | null
          note: string | null
          patient_id: string
          taken_at: string
        }
        Insert: {
          created_at?: string | null
          dose_slot_id?: string | null
          id?: string
          logged_by?: string | null
          meal_time?: string | null
          medication_id?: string | null
          note?: string | null
          patient_id: string
          taken_at: string
        }
        Update: {
          created_at?: string | null
          dose_slot_id?: string | null
          id?: string
          logged_by?: string | null
          meal_time?: string | null
          medication_id?: string | null
          note?: string | null
          patient_id?: string
          taken_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "med_logs_dose_slot_id_fkey"
            columns: ["dose_slot_id"]
            isOneToOne: false
            referencedRelation: "dose_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "med_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "med_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "med_logs_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "med_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "med_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      media_logs: {
        Row: {
          category: string
          created_at: string | null
          duration_seconds: number | null
          expires_at: string
          id: string
          logged_at: string
          logged_by: string | null
          media_type: string
          patient_id: string
          r2_key: string
          r2_url: string
          source: string
        }
        Insert: {
          category: string
          created_at?: string | null
          duration_seconds?: number | null
          expires_at: string
          id?: string
          logged_at: string
          logged_by?: string | null
          media_type: string
          patient_id: string
          r2_key: string
          r2_url: string
          source?: string
        }
        Update: {
          category?: string
          created_at?: string | null
          duration_seconds?: number | null
          expires_at?: string
          id?: string
          logged_at?: string
          logged_by?: string | null
          media_type?: string
          patient_id?: string
          r2_key?: string
          r2_url?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_appointments: {
        Row: {
          appointment_date: string
          created_at: string
          doctor_name: string | null
          hospital_name: string | null
          id: string
          notification_ids: string[] | null
          notified_day: boolean
          notified_week: boolean
          notify_day_before: boolean
          notify_week_before: boolean
          patient_id: string
        }
        Insert: {
          appointment_date: string
          created_at?: string
          doctor_name?: string | null
          hospital_name?: string | null
          id?: string
          notification_ids?: string[] | null
          notified_day?: boolean
          notified_week?: boolean
          notify_day_before?: boolean
          notify_week_before?: boolean
          patient_id: string
        }
        Update: {
          appointment_date?: string
          created_at?: string
          doctor_name?: string | null
          hospital_name?: string | null
          id?: string
          notification_ids?: string[] | null
          notified_day?: boolean
          notified_week?: boolean
          notify_day_before?: boolean
          notify_week_before?: boolean
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_record_medications: {
        Row: {
          change_type: string
          created_at: string
          dosage: string | null
          frequency: string | null
          id: string
          medical_record_id: string
          medication_name: string
        }
        Insert: {
          change_type?: string
          created_at?: string
          dosage?: string | null
          frequency?: string | null
          id?: string
          medical_record_id: string
          medication_name: string
        }
        Update: {
          change_type?: string
          created_at?: string
          dosage?: string | null
          frequency?: string | null
          id?: string
          medical_record_id?: string
          medication_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_record_medications_medical_record_id_fkey"
            columns: ["medical_record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_records: {
        Row: {
          consultation_notes: string | null
          created_at: string
          doctor_name: string | null
          hospital_name: string | null
          id: string
          patient_id: string
          prescription_changed: boolean
          prescription_image_url: string | null
          visit_date: string
        }
        Insert: {
          consultation_notes?: string | null
          created_at?: string
          doctor_name?: string | null
          hospital_name?: string | null
          id?: string
          patient_id: string
          prescription_changed?: boolean
          prescription_image_url?: string | null
          visit_date: string
        }
        Update: {
          consultation_notes?: string | null
          created_at?: string
          doctor_name?: string | null
          hospital_name?: string | null
          id?: string
          patient_id?: string
          prescription_changed?: boolean
          prescription_image_url?: string | null
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_dose_slots: {
        Row: {
          dose_slot_id: string
          medication_id: string
        }
        Insert: {
          dose_slot_id: string
          medication_id: string
        }
        Update: {
          dose_slot_id?: string
          medication_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_dose_slots_dose_slot_id_fkey"
            columns: ["dose_slot_id"]
            isOneToOne: false
            referencedRelation: "dose_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_dose_slots_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_history: {
        Row: {
          change_type: string | null
          changed_at: string | null
          changed_medication_id: string | null
          id: string
          patient_id: string | null
          snapshot: Json
        }
        Insert: {
          change_type?: string | null
          changed_at?: string | null
          changed_medication_id?: string | null
          id?: string
          patient_id?: string | null
          snapshot?: Json
        }
        Update: {
          change_type?: string | null
          changed_at?: string | null
          changed_medication_id?: string | null
          id?: string
          patient_id?: string | null
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "medication_history_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_history_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_pk_profile: {
        Row: {
          created_at: string | null
          drug_class: string
          duration_min: number | null
          edi_code: string | null
          id: string
          ingredient: string | null
          notes: string | null
          onset_min: number | null
          product_name: string
          strength: string | null
          suggested_slots: Json
          tmax_min: number | null
        }
        Insert: {
          created_at?: string | null
          drug_class: string
          duration_min?: number | null
          edi_code?: string | null
          id?: string
          ingredient?: string | null
          notes?: string | null
          onset_min?: number | null
          product_name: string
          strength?: string | null
          suggested_slots?: Json
          tmax_min?: number | null
        }
        Update: {
          created_at?: string | null
          drug_class?: string
          duration_min?: number | null
          edi_code?: string | null
          id?: string
          ingredient?: string | null
          notes?: string | null
          onset_min?: number | null
          product_name?: string
          strength?: string | null
          suggested_slots?: Json
          tmax_min?: number | null
        }
        Relationships: []
      }
      medications: {
        Row: {
          count_unit: string
          created_at: string | null
          daily_count: number | null
          dosage: string | null
          dosage_unit: string | null
          drug_code: string | null
          drug_image_url: string | null
          ended_at: string | null
          id: string
          is_active: boolean | null
          item_seq: string | null
          meal_schedules: Json | null
          meal_times: string[] | null
          name: string
          patient_id: string
          scheduled_times: string[] | null
          updated_at: string | null
        }
        Insert: {
          count_unit?: string
          created_at?: string | null
          daily_count?: number | null
          dosage?: string | null
          dosage_unit?: string | null
          drug_code?: string | null
          drug_image_url?: string | null
          ended_at?: string | null
          id?: string
          is_active?: boolean | null
          item_seq?: string | null
          meal_schedules?: Json | null
          meal_times?: string[] | null
          name: string
          patient_id: string
          scheduled_times?: string[] | null
          updated_at?: string | null
        }
        Update: {
          count_unit?: string
          created_at?: string | null
          daily_count?: number | null
          dosage?: string | null
          dosage_unit?: string | null
          drug_code?: string | null
          drug_image_url?: string | null
          ended_at?: string | null
          id?: string
          is_active?: boolean | null
          item_seq?: string | null
          meal_schedules?: Json | null
          meal_times?: string[] | null
          name?: string
          patient_id?: string
          scheduled_times?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      missed_med_sound_prefs: {
        Row: {
          first_sound_id: string | null
          second_sound_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          first_sound_id?: string | null
          second_sound_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          first_sound_id?: string | null
          second_sound_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "missed_med_sound_prefs_first_sound_id_fkey"
            columns: ["first_sound_id"]
            isOneToOne: false
            referencedRelation: "custom_sounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_med_sound_prefs_second_sound_id_fkey"
            columns: ["second_sound_id"]
            isOneToOne: false
            referencedRelation: "custom_sounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_med_sound_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_med_sound_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      news_feed: {
        Row: {
          created_at: string | null
          id: string
          published_at: string | null
          source: string | null
          thumbnail_url: string | null
          title: string
          url: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          published_at?: string | null
          source?: string | null
          thumbnail_url?: string | null
          title: string
          url: string
        }
        Update: {
          created_at?: string | null
          id?: string
          published_at?: string | null
          source?: string | null
          thumbnail_url?: string | null
          title?: string
          url?: string
        }
        Relationships: []
      }
      notification_debug_logs: {
        Row: {
          created_at: string | null
          event: string
          id: string
          is_cold_start: boolean | null
          notif_id: string | null
          notif_type: string | null
          payload: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event: string
          id?: string
          is_cold_start?: boolean | null
          notif_id?: string | null
          notif_type?: string | null
          payload?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event?: string
          id?: string
          is_cold_start?: boolean | null
          notif_id?: string | null
          notif_type?: string | null
          payload?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_debug_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_debug_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          body: string
          created_at: string
          data: Json | null
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json | null
          id?: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json | null
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      on_off_logs: {
        Row: {
          body_state: number | null
          constipation: boolean | null
          created_at: string | null
          dose_slot_id: string | null
          id: string
          logged_at: string
          logged_by: string | null
          med_log_id: string | null
          medication_meal_time: string | null
          mood: number | null
          patient_id: string
          sleep_quality: number | null
          trigger_time_label: string | null
          triggered_by: string
        }
        Insert: {
          body_state?: number | null
          constipation?: boolean | null
          created_at?: string | null
          dose_slot_id?: string | null
          id?: string
          logged_at: string
          logged_by?: string | null
          med_log_id?: string | null
          medication_meal_time?: string | null
          mood?: number | null
          patient_id: string
          sleep_quality?: number | null
          trigger_time_label?: string | null
          triggered_by: string
        }
        Update: {
          body_state?: number | null
          constipation?: boolean | null
          created_at?: string | null
          dose_slot_id?: string | null
          id?: string
          logged_at?: string
          logged_by?: string | null
          med_log_id?: string | null
          medication_meal_time?: string | null
          mood?: number | null
          patient_id?: string
          sleep_quality?: number | null
          trigger_time_label?: string | null
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "on_off_logs_dose_slot_id_fkey"
            columns: ["dose_slot_id"]
            isOneToOne: false
            referencedRelation: "dose_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "on_off_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "on_off_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "on_off_logs_med_log_id_fkey"
            columns: ["med_log_id"]
            isOneToOne: false
            referencedRelation: "med_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "on_off_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "on_off_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_group_members: {
        Row: {
          group_id: string
          id: string
          joined_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          group_id: string
          id?: string
          joined_at?: string | null
          role: string
          user_id: string
        }
        Update: {
          group_id?: string
          id?: string
          joined_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "patient_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_groups: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          invite_code: string
          invite_code_expires_at: string | null
          revenuecat_synced_at: string | null
          subscription_expires_at: string | null
          subscription_payer_user_id: string | null
          subscription_tier: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          invite_code: string
          invite_code_expires_at?: string | null
          revenuecat_synced_at?: string | null
          subscription_expires_at?: string | null
          subscription_payer_user_id?: string | null
          subscription_tier?: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          invite_code?: string
          invite_code_expires_at?: string | null
          revenuecat_synced_at?: string | null
          subscription_expires_at?: string | null
          subscription_payer_user_id?: string | null
          subscription_tier?: string
        }
        Relationships: []
      }
      post_bookmarks: {
        Row: {
          created_at: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_bookmarks_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_media: {
        Row: {
          created_at: string | null
          id: string
          media_type: string
          post_id: string
          r2_key: string
          r2_url: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          media_type: string
          post_id: string
          r2_key: string
          r2_url: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          media_type?: string
          post_id?: string
          r2_key?: string
          r2_url?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_media_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reports: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          post_id: string | null
          reason: string
          reporter_id: string
          resolved: boolean
          resolved_at: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          post_id?: string | null
          reason: string
          reporter_id: string
          resolved?: boolean
          resolved_at?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          post_id?: string | null
          reason?: string
          reporter_id?: string
          resolved?: boolean
          resolved_at?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          comment_count: number | null
          content: string
          created_at: string | null
          hidden: boolean
          hidden_at: string | null
          hidden_reason: string | null
          id: string
          is_news: boolean | null
          like_count: number | null
          news_url: string | null
          post_type: string
          title: string
          updated_at: string | null
          view_count: number | null
          youtube_thumbnail: string | null
          youtube_url: string | null
        }
        Insert: {
          author_id: string
          comment_count?: number | null
          content: string
          created_at?: string | null
          hidden?: boolean
          hidden_at?: string | null
          hidden_reason?: string | null
          id?: string
          is_news?: boolean | null
          like_count?: number | null
          news_url?: string | null
          post_type: string
          title: string
          updated_at?: string | null
          view_count?: number | null
          youtube_thumbnail?: string | null
          youtube_url?: string | null
        }
        Update: {
          author_id?: string
          comment_count?: number | null
          content?: string
          created_at?: string | null
          hidden?: boolean
          hidden_at?: string | null
          hidden_reason?: string | null
          id?: string
          is_news?: boolean | null
          like_count?: number | null
          news_url?: string | null
          post_type?: string
          title?: string
          updated_at?: string | null
          view_count?: number | null
          youtube_thumbnail?: string | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_items: {
        Row: {
          created_at: string | null
          dose_per_take: number | null
          edi_code: string | null
          free_text: string | null
          id: string
          meal_relation: string | null
          prescription_id: string
          product_name: string
          takes_per_day: number | null
          timing_slots: Json
          total_days: number | null
        }
        Insert: {
          created_at?: string | null
          dose_per_take?: number | null
          edi_code?: string | null
          free_text?: string | null
          id?: string
          meal_relation?: string | null
          prescription_id: string
          product_name: string
          takes_per_day?: number | null
          timing_slots?: Json
          total_days?: number | null
        }
        Update: {
          created_at?: string | null
          dose_per_take?: number | null
          edi_code?: string | null
          free_text?: string | null
          id?: string
          meal_relation?: string | null
          prescription_id?: string
          product_name?: string
          takes_per_day?: number | null
          timing_slots?: Json
          total_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string | null
          hospital: string | null
          id: string
          image_url: string | null
          issued_at: string
          patient_id: string
          raw_ocr_text: string | null
          source: string
        }
        Insert: {
          created_at?: string | null
          hospital?: string | null
          id?: string
          image_url?: string | null
          issued_at: string
          patient_id: string
          raw_ocr_text?: string | null
          source?: string
        }
        Update: {
          created_at?: string | null
          hospital?: string | null
          id?: string
          image_url?: string | null
          issued_at?: string
          patient_id?: string
          raw_ocr_text?: string | null
          source?: string
        }
        Relationships: []
      }
      symptom_notes: {
        Row: {
          created_at: string | null
          id: string
          logged_at: string
          note: string
          patient_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          logged_at: string
          note: string
          patient_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          logged_at?: string
          note?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "symptom_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "symptom_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "public_user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          banned: boolean
          banned_at: string | null
          banned_reason: string | null
          birth_year: number | null
          caregiver_notif_prefs: Json | null
          caregiver_relation: string | null
          created_at: string | null
          diagnosis_year: number | null
          exercise_notif_prefs: Json | null
          gender: string | null
          id: string
          international_transfer_consent_version: number | null
          international_transfer_consented: boolean | null
          kakao_id: string | null
          meal_schedules: Json | null
          med_notif_prefs: Json | null
          med_time_notif_prefs: Json | null
          med_time_sound_prefs: Json
          name: string
          notification_enabled: boolean | null
          onboarding_done: boolean | null
          patient_group_id: string | null
          push_platform: string | null
          push_token: string | null
          relation_note: string | null
          residence_type: string | null
          role: string
          sensitive_info_consent_version: number | null
          sensitive_info_consented: boolean | null
          updated_at: string | null
        }
        Insert: {
          banned?: boolean
          banned_at?: string | null
          banned_reason?: string | null
          birth_year?: number | null
          caregiver_notif_prefs?: Json | null
          caregiver_relation?: string | null
          created_at?: string | null
          diagnosis_year?: number | null
          exercise_notif_prefs?: Json | null
          gender?: string | null
          id?: string
          international_transfer_consent_version?: number | null
          international_transfer_consented?: boolean | null
          kakao_id?: string | null
          meal_schedules?: Json | null
          med_notif_prefs?: Json | null
          med_time_notif_prefs?: Json | null
          med_time_sound_prefs?: Json
          name: string
          notification_enabled?: boolean | null
          onboarding_done?: boolean | null
          patient_group_id?: string | null
          push_platform?: string | null
          push_token?: string | null
          relation_note?: string | null
          residence_type?: string | null
          role: string
          sensitive_info_consent_version?: number | null
          sensitive_info_consented?: boolean | null
          updated_at?: string | null
        }
        Update: {
          banned?: boolean
          banned_at?: string | null
          banned_reason?: string | null
          birth_year?: number | null
          caregiver_notif_prefs?: Json | null
          caregiver_relation?: string | null
          created_at?: string | null
          diagnosis_year?: number | null
          exercise_notif_prefs?: Json | null
          gender?: string | null
          id?: string
          international_transfer_consent_version?: number | null
          international_transfer_consented?: boolean | null
          kakao_id?: string | null
          meal_schedules?: Json | null
          med_notif_prefs?: Json | null
          med_time_notif_prefs?: Json | null
          med_time_sound_prefs?: Json
          name?: string
          notification_enabled?: boolean | null
          onboarding_done?: boolean | null
          patient_group_id?: string | null
          push_platform?: string | null
          push_token?: string | null
          relation_note?: string | null
          residence_type?: string | null
          role?: string
          sensitive_info_consent_version?: number | null
          sensitive_info_consented?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      web_login_attempts: {
        Row: {
          fail_count: number
          ip: string
          updated_at: string
          window_start: string
        }
        Insert: {
          fail_count?: number
          ip: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          fail_count?: number
          ip?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      web_login_tokens: {
        Row: {
          created_at: string
          expires_at: string
          ip_address: unknown
          token: string
          used_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          ip_address?: unknown
          token: string
          used_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          ip_address?: unknown
          token?: string
          used_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_user_profiles: {
        Row: {
          id: string | null
          name: string | null
          role: string | null
        }
        Insert: {
          id?: string | null
          name?: string | null
          role?: string | null
        }
        Update: {
          id?: string | null
          name?: string | null
          role?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _fl_move_self_into_group: {
        Args: {
          p_old_group: string
          p_role: string
          p_target_group: string
          p_uid: string
        }
        Returns: undefined
      }
      admin_delete_content: {
        Args: { p_target_id: string; p_target_type: string }
        Returns: undefined
      }
      admin_list_reports: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_only_visible?: boolean
          p_status?: string
        }
        Returns: {
          author_banned: boolean
          author_id: string
          author_name: string
          content_preview: string
          hidden: boolean
          hidden_at: string
          hidden_reason: string
          last_reported_at: string
          media_keys: string[]
          reasons: string[]
          report_count: number
          resolved: boolean
          target_id: string
          target_type: string
        }[]
      }
      admin_set_content_hidden: {
        Args: {
          p_hidden: boolean
          p_reason?: string
          p_target_id: string
          p_target_type: string
        }
        Returns: undefined
      }
      admin_set_reports_resolved: {
        Args: {
          p_resolved: boolean
          p_target_id: string
          p_target_type: string
        }
        Returns: undefined
      }
      admin_set_user_banned: {
        Args: {
          p_banned: boolean
          p_hide_content?: boolean
          p_reason?: string
          p_user_id: string
        }
        Returns: undefined
      }
      cancel_patient_record: {
        Args: { p_record_id: string; p_table: string }
        Returns: undefined
      }
      delete_custom_sound: { Args: { p_sound_id: string }; Returns: boolean }
      delete_dose_slot_with_records: {
        Args: { p_dose_slot_id: string }
        Returns: undefined
      }
      disconnect_family_group: {
        Args: { p_group_id: string }
        Returns: undefined
      }
      get_invite_patient_masked_name: {
        Args: { p_code: string }
        Returns: string
      }
      get_meds_at_time: {
        Args: { target_time: string }
        Returns: {
          dose_slot_id: string
          label: string
          meal_time: string
          patient_id: string
          time: string
        }[]
      }
      get_patient_missed_med_sound: {
        Args: { p_patient_id: string }
        Returns: {
          first_sound_id: string
          second_sound_id: string
        }[]
      }
      increment_view_count: { Args: { post_id: string }; Returns: undefined }
      is_same_group: {
        Args: { target_id: string; viewer_id: string }
        Returns: boolean
      }
      is_same_patient_group: {
        Args: { target_user_id: string }
        Returns: boolean
      }
      join_family_by_code: {
        Args: { p_code: string; p_force?: boolean }
        Returns: Json
      }
      update_custom_sound: {
        Args: {
          p_duration_ms?: number
          p_label: string
          p_public_url?: string
          p_r2_key_src?: string
          p_sound_id: string
        }
        Returns: boolean
      }
      update_patient_missed_med_sound: {
        Args: { p_patient_id: string; p_phase: string; p_sound_id: string }
        Returns: undefined
      }
      update_patient_notif_prefs: {
        Args: { p_patient_id: string; p_prefs: Json }
        Returns: undefined
      }
      update_patient_onoff_record: {
        Args: {
          p_body_state: number
          p_constipation: boolean
          p_mood: number
          p_record_id: string
          p_sleep_quality: number
        }
        Returns: undefined
      }
      upsert_med_log_time: {
        Args: {
          p_dose_slot_id: string
          p_logged_by: string
          p_meal_time: string
          p_patient_id: string
          p_taken_at: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
