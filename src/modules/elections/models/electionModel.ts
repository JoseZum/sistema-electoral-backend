export interface Election {
  id: string;
  title: string;
  description: string | null;
  status: 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'SCRUTINIZED' | 'ARCHIVED';
  is_anonymous: boolean;
  allow_suboptions: boolean;
  auth_method: 'MICROSOFT';
  voter_source: 'FULL_PADRON' | 'FILTERED' | 'MANUAL' | 'TAG';
  voter_filter: Record<string, unknown> | null;
  tag_id: string | null;
  tag_name?: string | null;
  tag_color?: string | null;
  tag_description?: string | null;
  tag_member_count?: number | null;
  starts_immediately: boolean;
  immediate_minutes: number | null;
  requires_keys: boolean;
  min_keys: number;
  start_time: Date | null;
  end_time: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ElectionTagSummary {
  id: string;
  name: string;
  color: string;
  description: string | null;
  member_count: number;
}

export interface ElectionOption {
  id: string;
  election_id: string;
  parent_option_id: string | null;
  label: string;
  option_type: string;
  image_url: string | null;
  display_order: number;
  metadata: Record<string, unknown> | null;
  suboptions?: ElectionOption[];
}

export interface ElectionVoter {
  election_id: string;
  student_id: string;
  token_used: boolean;
  token_used_at: Date | null;
}

export interface ElectionWithStats extends Election {
  total_voters: number;
  votes_cast: number;
  options_count: number;
}

export interface CreateElectionDto {
  title: string;
  description?: string;
  is_anonymous: boolean;
  allow_suboptions?: boolean;
  auth_method?: Election['auth_method'];
  status?: Election['status'] | 'AUTO';
  voter_source: Election['voter_source'];
  voter_filter?: Record<string, unknown>;
  tag_id?: string | null;
  starts_immediately?: boolean;
  immediate_minutes?: number | null;
  requires_keys?: boolean;
  min_keys?: number | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface CreateElectionRequestDto extends CreateElectionDto {
  options?: CreateOptionDto[];
  populate?: PopulateVotersDto;
}

export interface UpdateElectionDto {
  title?: string;
  description?: string;
  is_anonymous?: boolean;
  allow_suboptions?: boolean;
  auth_method?: Election['auth_method'];
  status?: Election['status'];
  voter_source?: Election['voter_source'];
  voter_filter?: Record<string, unknown>;
  tag_id?: string | null;
  starts_immediately?: boolean;
  immediate_minutes?: number | null;
  requires_keys?: boolean;
  min_keys?: number | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface CreateOptionDto {
  label: string;
  description?: string;
  option_type: ElectionOption['option_type'];
  parent_option_id?: string | null;
  image_url?: string | null;
  display_order?: number;
  metadata?: Record<string, unknown>;
  suboptions?: CreateOptionDto[];
}

export interface UpdateOptionDto {
  label?: string;
  description?: string;
  option_type?: ElectionOption['option_type'];
  image_url?: string | null;
  display_order?: number;
  metadata?: Record<string, unknown>;
}

export interface PopulateVotersDto {
  sede?: string;
  career?: string;
  student_ids?: string[];
  tag_id?: string;
}

export interface ElectionResultVoter {
  full_name: string;
  carnet: string;
  has_voted: boolean;
  selected_option_label: string | null;
}

export interface ElectionResultOption {
  id: string;
  label: string;
  option_type: string;
  parent_option_id: string | null;
  image_url: string | null;
  metadata: Record<string, unknown> | null;
  vote_count: number;
  percentage: number;
  suboptions?: ElectionResultOption[];
}

export interface ElectionResults {
  election: Election;
  options: ElectionResultOption[];
  total_votes: number;
  total_eligible: number;
  participation_rate: number;
  voters?: ElectionResultVoter[];
}

// Para monitoreo

export interface VotesByHour {
  hour: string;
  count: number;
}

export interface MonitoringData {
  votesByHour: VotesByHour[];
}
