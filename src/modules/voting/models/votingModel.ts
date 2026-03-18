export interface VoterElection {
  id: string;
  title: string;
  description: string | null;
  status: string;
  is_anonymous: boolean;
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
  start_time: Date | null;
  end_time: Date | null;
  has_voted: boolean;
  options: VoteOption[];
}

export interface VoteOption {
  id: string;
  label: string;
  option_type: string;
  display_order: number;
}

export interface CastVoteDto {
  electionId: string;
  optionId: string;
  token?: string;  // required for anonymous elections
}

export interface VoteTokenResponse {
  token: string;
  election_id: string;
  expires_info: string;
}

export interface PublicResults {
  election_id: string;
  title: string;
  options: Array<{
    label: string;
    option_type: string;
    vote_count: number;
    percentage: number;
  }>;
  total_votes: number;
  participation_rate: number;
}
