export interface VoterElection {
  id: string;
  title: string;
  description: string | null;
  status: string;
  is_anonymous: boolean;
  allow_suboptions: boolean;
  tag_name: string | null;
  tag_color: string | null;
  start_time: Date | null;
  end_time: Date | null;
  has_voted: boolean;
  total_options: number;
}

export interface VoterElectionDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  is_anonymous: boolean;
  allow_suboptions: boolean;
  tag_name: string | null;
  tag_color: string | null;
  start_time: Date | null;
  end_time: Date | null;
  has_voted: boolean;
  options: VoteOption[];
}

export interface VoteOption {
  id: string;
  election_id?: string;
  parent_option_id: string | null;
  label: string;
  option_type: string;
  image_url: string | null;
  display_order: number;
  metadata?: Record<string, unknown> | null;
  suboptions?: VoteOption[];
}

export interface VoteSelectionDto {
  parentOptionId: string;
  optionId: string;
}

export interface CastVoteDto {
  electionId: string;
  optionId?: string;
  selections?: VoteSelectionDto[];
}

export interface PublicResultOption {
  id?: string;
  label: string;
  option_type: string;
  parent_option_id?: string | null;
  image_url?: string | null;
  metadata?: Record<string, unknown> | null;
  vote_count: number;
  percentage?: number;
  suboptions?: PublicResultOption[];
}

export interface PublicResults {
  election_id: string;
  title: string;
  options: PublicResultOption[];
  total_votes: number;
  participation_rate: number;
}
