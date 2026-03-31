import { Student } from "../../users/models/userModel";
export interface ScrutinyInfo{
    id: string;
    title: string;
    status: string
    member_assign: number;
    keys_submitted: number;
    members_remain?: Student[];
    can_finalize: boolean;
    total_votes: number;
    total_eligibles: number;
    participation_rate: number;
    publication_status: 'results_available' | 'finalized_at';
}

export interface AssingMembersDTO{
    option: number;
    election_id: string;
    students_id: string[];
}

export interface submitKeyDTO {
    election_id: string;
    member_id: string;
    key_shard: string;
}

export interface scrutinykeys{
    id: string;           
    election_id: string;  
    member_id: string;
    key_shard: string;    
    has_submitted: boolean;
    submitted_at: Date; 
}