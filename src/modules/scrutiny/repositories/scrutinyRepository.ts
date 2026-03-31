import { pool } from "../../../config/database";
import { Pool, PoolClient } from 'pg';
import { findElectionById } from "../../elections/repositories/electionRepository";
import { AssingMembersDTO, submitKeyDTO, scrutinykeys } from "../models/scrutiny.types";
import { Election } from "../../elections/models/electionModel";

type Queyable = Pool | PoolClient;

export async function getScrutinyProgress(election_id:string) {
    const election = await findElectionById(election_id)
    if (!election) return null;

    const statsScrutinyResult = await pool.query<{
        total_members: string; 
        submitted_key: string 
        pending: string;
    }>(`
       SELECT
            sk.election_id,
            COUNT(DISTINCT sk.member_id) AS total_members,
            SUM(CASE WHEN sk.has_submitted = true THEN 1 ELSE 0 END) AS submitted_key,
            SUM(CASE WHEN sk.has_submitted = false THEN 1 ELSE 0 END) AS pending,
        FROM scrutiny_keys sk 
        WHERE sk.election_id = $1
        GROUP BY sk.election_id;
        `, [election_id]);
    const row = statsScrutinyResult.rows[0];
    if (!row) return null;

    const listMemberPending = await pool.query<{
        id: string;
        full_name: string;
        carnet: string;
        email: string;
    }>(`
    SELECT 
        s.id
        s.full_name,
        s.carnet,
        s.email
    FROM scrutiny_keys sk
    INNER JOIN students s ON sk.member_id = s.id
    WHERE sk.election_id = $1
        AND sk.has_submitted = false
    ORDER BY s.full_name 
    `, [election_id]);

    return {
        total_Members: parseInt(row.total_members),
        submittedKeys: parseInt(row.submitted_key),
        pending: parseInt(row.pending),
        membersPending: listMemberPending.rows.map(row =>({
            id: row.id,
            full_name: row.full_name,
            carnet: row.carnet,      
        }))
    };
}

export async function addMembersElection(data: AssingMembersDTO, keysHash?: string[], cretedBy?: string) {
    const memberIds = data.students_id;
    const keyHashes = keysHash;

    if (!memberIds || memberIds.length === 0) {
        throw new Error('students_id es obligatorio y no puede estar vacío.');
    }

    if (!keyHashes || keyHashes.length !== memberIds.length) {
        throw new Error('keysHash es obligatorio y debe tener la misma cantidad de elementos que students_id.');
    }

    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const values: string[] = [];
        const params: any[] = [data.election_id];
        let paramIndex = 2;

        memberIds.forEach((member_id, index) => {
            const currentKey = keyHashes[index];
            if (!currentKey) {
                throw new Error(`keyHash indefinido en índice ${index}`);
            }
            values.push(`($1, $${paramIndex}, $${paramIndex + 1}, false)`);
            params.push(member_id, currentKey);
            paramIndex += 2;
        });

        const query = `
            INSERT INTO scrutiny_keys (election_id, member_id, key_shard, has_submitted)
            VALUES ${values.join(', ')}
            ON CONFLICT (election_id, member_id) DO NOTHING
        `;
         await cliente.query(query, params);
         await cliente.query('COMMIT');

    } catch (error) {
        await cliente.query('ROLLBACK');
        throw new Error("Problemas al realizar bulk insert $1");

    } finally{
        cliente.release();
    }
    
}

export async function checkKey(data:submitKeyDTO, keyHash: string ): Promise<boolean>{
    const result = await pool.query<{exists: boolean}>(`
        SELECT EXISTS(SELECT 1 FROM scrutiny_keys s
        WHERE s.election_id = $1 
        AND s.member_id = $2 
        AND s.key_shard = $3
        ) AS exists `, 
         [data.election_id, data.member_id, keyHash]);
    return result.rows[0]?.exists ?? false;
}

export async function submitKeys(data: submitKeyDTO): Promise<scrutinykeys | null>{
    const result = await pool.query<scrutinykeys>(`
        UPDATE scrutiny_Keys SET has_submitted = true, submitted_at = now() 
        WHERE election_id = $1 and member_id = $2 RETURNING *
        `, [data.election_id, data.member_id]);
    return result.rows[0] || null;
}

export async function finalizeScrutine(electionId:string, finalizedBy?:string): Promise<Election | null>{
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const election = await findElectionById(electionId);
        if (!election) throw new Error("Elección encontrada");
        if(election.status === 'SCRUTINIZED') throw new Error('La elección ya esta finalizada');

        const progress = await getScrutinyProgress(electionId);

        if(!progress || (election.requires_keys && election.min_keys > progress.submittedKeys)){
            throw new Error('No se han agregado las llaves necesarias para finalizar el escrutinio');
        }

        const update = await client.query<Election>(
            'UPDATE elections SET status = $1 WHERE id = $2 RETURNING *',
            ['SCRUTINIZED', electionId]
        );

        await client.query(
            'INSERT INTO audit_logs (action, entity_type, entity_id, user_id, details, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
            ['FINALIZE_SCRUTINY', 'election', electionId, finalizedBy, 'Elección Finalizada luego de validar las llaves']
        );

        await client.query('COMMIT');

        return update.rows[0];
    
    } catch(error){
        await client.query('ROLLBACK');
        throw new Error("Error al finalizar la eleccion")
    } finally{ 
        client.release();
    }
}