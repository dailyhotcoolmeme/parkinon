export type UserRole = 'patient' | 'caregiver';
export type ResidenceType = 'together' | 'separate';
export type CaregiverRelation = 'spouse' | 'child' | 'sibling' | 'other';
export type MealTime = 'morning' | 'lunch' | 'dinner' | 'bedtime';
export type TriggeredBy = 'notification' | 'manual';
export type PostType = 'chat' | 'question' | 'info' | 'exercise' | 'cheer';

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          kakao_id: string | null;
          name: string;
          birth_year: number | null;
          gender: 'male' | 'female' | null;
          role: UserRole;
          caregiver_relation: CaregiverRelation | null;
          relation_note: string | null;
          residence_type: ResidenceType | null;
          diagnosis_year: number | null;
          patient_group_id: string | null;
          onboarding_done: boolean;
          notification_enabled: boolean;
          push_token: string | null;
          med_time_notif_prefs: Record<string, boolean> | null;
          med_notif_prefs: unknown[] | null;
          exercise_notif_prefs: unknown[] | null;
          caregiver_notif_prefs: Record<string, boolean> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
        Relationships: [];
      };
      patient_groups: {
        Row: {
          id: string;
          invite_code: string;
          invite_code_expires_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['patient_groups']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['patient_groups']['Insert']>;
        Relationships: [];
      };
      patient_group_members: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          role: UserRole;
          joined_at: string;
        };
        Insert: Omit<Database['public']['Tables']['patient_group_members']['Row'], 'id' | 'joined_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['patient_group_members']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'patient_group_members_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'patient_groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'patient_group_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      medications: {
        Row: {
          id: string;
          patient_id: string;
          name: string;
          dosage: string | null;
          meal_times: MealTime[];
          meal_schedules: Record<string, string> | null;
          scheduled_times: string[];
          drug_code: string | null;
          drug_image_url: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['medications']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['medications']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'medications_patient_id_fkey';
            columns: ['patient_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      med_logs: {
        Row: {
          id: string;
          patient_id: string;
          logged_by: string;
          medication_id: string | null;
          taken_at: string;
          meal_time: MealTime;
          note: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['med_logs']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['med_logs']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'med_logs_patient_id_fkey';
            columns: ['patient_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'med_logs_logged_by_fkey';
            columns: ['logged_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      on_off_logs: {
        Row: {
          id: string;
          patient_id: string;
          logged_by: string;
          body_state: number | null;
          mood: number | null;
          sleep_quality: number | null;
          constipation: boolean | null;
          triggered_by: TriggeredBy;
          trigger_time_label: string | null;
          logged_at: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['on_off_logs']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['on_off_logs']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'on_off_logs_patient_id_fkey';
            columns: ['patient_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      exercise_logs: {
        Row: {
          id: string;
          patient_id: string;
          logged_by: string;
          exercise_type: string;
          duration_minutes: number;
          logged_at: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['exercise_logs']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['exercise_logs']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'exercise_logs_patient_id_fkey';
            columns: ['patient_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      symptom_notes: {
        Row: {
          id: string;
          patient_id: string;
          note: string;
          logged_at: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['symptom_notes']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['symptom_notes']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'symptom_notes_patient_id_fkey';
            columns: ['patient_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      media_logs: {
        Row: {
          id: string;
          patient_id: string;
          logged_by: string;
          media_type: 'video' | 'photo';
          r2_key: string;
          r2_url: string;
          duration_seconds: number | null;
          category: 'body_state' | 'exercise';
          logged_at: string;
          expires_at: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['media_logs']['Row'], 'id' | 'created_at' | 'duration_seconds'> & { id?: string; duration_seconds?: number | null };
        Update: Partial<Database['public']['Tables']['media_logs']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'media_logs_patient_id_fkey';
            columns: ['patient_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      news_feed: {
        Row: {
          id: string;
          title: string;
          url: string;
          source: string | null;
          thumbnail_url: string | null;
          published_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['news_feed']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['news_feed']['Insert']>;
        Relationships: [];
      };
      posts: {
        Row: {
          id: string;
          author_id: string;
          post_type: PostType;
          title: string;
          content: string;
          view_count: number;
          like_count: number;
          comment_count: number;
          is_news: boolean;
          news_url: string | null;
          youtube_url: string | null;
          youtube_thumbnail: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['posts']['Row'], 'id' | 'created_at' | 'updated_at' | 'view_count' | 'like_count' | 'comment_count'> & { id?: string };
        Update: Partial<Database['public']['Tables']['posts']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'posts_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      comments: {
        Row: {
          id: string;
          post_id: string;
          author_id: string;
          parent_id: string | null;
          content: string;
          like_count: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['comments']['Row'], 'id' | 'created_at' | 'like_count'> & { id?: string };
        Update: Partial<Database['public']['Tables']['comments']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'comments_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comments_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      post_media: {
        Row: {
          id: string;
          post_id: string;
          r2_key: string;
          r2_url: string;
          media_type: 'image' | 'video';
          sort_order: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['post_media']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['post_media']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'post_media_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
