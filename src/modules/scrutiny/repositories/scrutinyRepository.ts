import { pool } from "../../../config/database";
import { Pool, PoolClient } from 'pg';
import { AssingMembersDTO, submitKeyDTO, scrutinykeys } from "../models/scrutiny.types";
import { Election } from "../../elections/models/electionModel";
import { badRequest, conflict, internalError, notFound } from "../../../errors/httpErrors";

type Queryable = Pool | PoolClient;

export async function getScrutinyProgress(election_id:string, db: Queryable = pool) {
    const statsScrutinyResult = await db.query<{
        total_members: string; 
        submitted_key: string 
        pending: string;
    }>(`
       SELECT
            sk.election_id,
            COUNT(DISTINCT sk.member_id) AS total_members,
            SUM(CASE WHEN sk.has_submitted = true THEN 1 ELSE 0 END) AS submitted_key,
            SUM(CASE WHEN sk.has_submitted = false THEN 1 ELSE 0 END) AS pending
        FROM scrutiny_keys sk 
        WHERE sk.election_id = $1
        GROUP BY sk.election_id;
        `, [election_id]);
    const row = statsScrutinyResult.rows[0];
    if (!row) {
        return {
            total_Members: 0,
            submittedKeys: 0,
            pending: 0
        };
    }

    return {
        total_Members: parseInt(row.total_members),
        submittedKeys: parseInt(row.submitted_key),
        pending: parseInt(row.pending)
    };
};

export async function getStateKeys(election_id: string) {
    const listMemberPending = await pool.query<{
        id: string;
        full_name: string;
        carnet: string;
        email: string;
        date: Date;
        has_submitted: boolean;
    }>(`
    SELECT 
        s.id,
        s.full_name,
        s.carnet, 
        sk.submitted_at as date,
        sk.has_submitted
    FROM scrutiny_keys sk
    INNER JOIN students s ON sk.member_id = s.id
    WHERE sk.election_id = $1
    ORDER BY s.full_name 
    `, [election_id]);
    
    return listMemberPending.rows;
}



export async function addMembersElection(electionId: string, data: AssingMembersDTO, keysHash?: string[], cretedBy?: string) {
    const memberIds = data.students_id;
    const keyHashes = keysHash;
    if (!memberIds || memberIds.length === 0) {
        throw badRequest('SCRUTINY_MEMBERS_REQUIRED', 'students_id es obligatorio y no puede estar vacío.');
    }
    if (!keyHashes || keyHashes.length !== memberIds.length) {
        throw internalError(
            'SCRUTINY_KEY_HASH_MISMATCH',
            'keysHash es obligatorio y debe tener la misma cantidad de elementos que students_id.'
        );
    }

    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const values: string[] = [];
        const params: any[] = [electionId];
        let paramIndex = 2;

        memberIds.forEach((member_id, index) => {
            const currentKey = keyHashes[index];
            if (!currentKey) {
                throw internalError('SCRUTINY_KEY_HASH_MISSING', `keyHash indefinido en índice ${index}`);
            }
            values.push(`($1, $${paramIndex}, $${paramIndex + 1}, false)`);
            params.push(member_id, currentKey);
            paramIndex += 2;
        });

        const query = `
            INSERT INTO scrutiny_keys (election_id, member_id, key_shard, has_submitted)
            VALUES ${values.join(', ')}
            ON CONFLICT (election_id, member_id)
            DO UPDATE SET
                key_shard = EXCLUDED.key_shard,
                has_submitted = false,
                submitted_at = null
        `;
        await cliente.query(query, params);
        await cliente.query('COMMIT');
        return true;
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;

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
        AND s.has_submitted = false
        ) AS exists `, 
         [data.election_id, data.member_id, keyHash]);
    return result.rows[0]?.exists ?? false;
}

export async function checkDuplicate(data: string[], electionId: string): Promise<boolean>{
    const values: string[] = [];
    const params: any[] = [electionId];
    let paramIndex = 2;
    
    data.forEach((userId)=>{
        values.push(`s.member_id = $${paramIndex} `)
        params.push(userId);
        paramIndex += 1;
    });

    const query = `SELECT EXISTS(SELECT 1 FROM scrutiny_keys s
        WHERE s.election_id = $1
        AND (${values.join(' OR ')})
        ) AS exists`;
    
    const result = await pool.query<{exists: boolean}>(query, params);
    
    return result.rows[0].exists;

}

export async function submitKeys(data: submitKeyDTO): Promise<scrutinykeys | null>{
    const result = await pool.query<scrutinykeys>(`
        UPDATE scrutiny_Keys SET has_submitted = true, submitted_at = now() 
        WHERE election_id = $1 and member_id = $2 and has_submitted = false RETURNING *
        `, [data.election_id, data.member_id]);
    
        return result.rows[0] || null;
}

export async function finalizeScrutine(electionId:string, finalizedBy?:string): Promise<Election | null>{
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const electionResult = await client.query<Election>(
            'SELECT * FROM elections WHERE id = $1 FOR UPDATE',
            [electionId]
        );
        const election = electionResult.rows[0];
        if (!election) throw notFound('SCRUTINY_ELECTION_NOT_FOUND', 'Eleccion no encontrada');
        if(election.status === 'SCRUTINIZED') throw conflict('SCRUTINY_ELECTION_ALREADY_FINALIZED', 'La elección ya esta finalizada');
        if(election.status !== 'CLOSED') throw conflict('SCRUTINY_FINALIZE_ELECTION_NOT_CLOSED', 'Solo se puede finalizar el escrutinio de elecciones cerradas');

        const progress = await getScrutinyProgress(electionId, client);

        if(election.requires_keys && election.min_keys > progress.submittedKeys){
            throw conflict(
                'SCRUTINY_KEYS_INSUFFICIENT',
                'No se han entregado las llaves necesarias para finalizar el escrutinio',
                {
                    submittedKeys: progress.submittedKeys,
                    minKeys: election.min_keys
                }
            );
        }

        const update = await client.query<Election>(
            `UPDATE elections
             SET status = $1,
                 scrutinized_at = COALESCE(scrutinized_at, now())
             WHERE id = $2
             RETURNING *`,
            ['SCRUTINIZED', electionId]
        );

        await client.query(
            `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, details, created_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
            [
                finalizedBy || null,
                'scrutiny.finalize',
                'election',
                electionId,
                JSON.stringify({
                    election_title: election.title,
                    requires_keys: election.requires_keys,
                    required_keys: election.requires_keys ? election.min_keys : 0,
                    submitted_keys: progress.submittedKeys,
                    total_members: progress.total_Members
                })
            ]
        );

        await client.query('COMMIT');

        return update.rows[0];
    
    } catch(error){
        await client.query('ROLLBACK');
        throw error;
    } finally{ 
        client.release();
    }
}
