import * as scrutinyRepository from '../repositories/scrutinyRepository';
import { ScrutinyInfo, AssingMembersDTO, submitKeyDTO} from '../models/scrutiny.types';
import { withAuditContext } from '../../../config/audit-context';
import { PoolClient } from 'pg';
import { syncAutomaticStatuses, findElectionById, getElectionResults } from '../../elections/repositories/electionRepository';
import {randomInt, randomBytes, createHash } from 'crypto';
import { badRequest, conflict, forbidden, internalError, notFound } from '../../../errors/httpErrors';
import { isAppError } from '../../../errors/appError';


function validateStudentID(listMembers: AssingMembersDTO){
    if (!Array.isArray(listMembers.students_id) || listMembers.students_id.length === 0) {
        throw badRequest('SCRUTINY_MEMBERS_REQUIRED', 'students_id es obligatorio y no puede estar vacío.');
    }

    if (new Set(listMembers.students_id).size !== listMembers.students_id.length) 
        throw badRequest('SCRUTINY_DUPLICATE_STUDENT_IDS', 'No se permiten id de usuario duplicados');
}

function generateAlfaNumkeys():string{
    return randomBytes(8).toString('hex').substring(0, 8)
}

function hashkey(key: string){
    return createHash('sha256').update(key).digest('hex');
}

function isAlreadyFinalizedError(error: unknown): boolean {
    return isAppError(error) && error.code === 'SCRUTINY_ELECTION_ALREADY_FINALIZED';
}

function generateNums(): string{
    const bytes = randomBytes(6);
    let result = '';

    for (let i =0; i < 6 ; i++){
        result += (bytes[i] %10 ).toString();
    }
    return result;
}



function generateKeys(listMembers: AssingMembersDTO){
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let kType;
    let keys: string[] = [];
    let keysHash: string[] = [];
    listMembers.students_id.forEach(() => {
        if (listMembers.option === "0") kType = generateNums();
        else kType = generateAlfaNumkeys(); //listMembers.keys?.push(generateAlfaNumkeys());
        keys.push(kType);
        keysHash.push(hashkey(kType));
    });
    return {keys, keysHash}
}

export async function getOperativeStateElection(electionId: string) {
    await syncAutomaticStatuses();
    const election = await findElectionById(electionId);
    if (!election) throw notFound('SCRUTINY_ELECTION_NOT_FOUND', 'Elección no encontrada');
    const resultsElection = await getElectionResults(electionId);
    if(!resultsElection) throw internalError('SCRUTINY_RESULTS_FETCH_FAILED', 'No se pudieron obtener los resultados');
    const progresElection = await scrutinyRepository.getScrutinyProgress(electionId);
    if (!progresElection) throw internalError('SCRUTINY_PROGRESS_FETCH_FAILED', 'No se pudiero obtener el progreso de la elección');
    const pendingStudents = await scrutinyRepository.getStateKeys(electionId);
    const canFinalize = !election.requires_keys || progresElection.submittedKeys >= election.min_keys;
    return {
        electionInfo: {
            id: election.id,
            title: election.title,
            status: election.status,
            requires_keys: election.requires_keys,
            min_keys: election.min_keys
        },
        progressScrutiny: {
            total_Members: progresElection.total_Members,
            submittedKeys: progresElection.submittedKeys,
            membersPending: pendingStudents,
            can_finalize: canFinalize
        },
        general_Metric: {
            total_votes: resultsElection.total_votes,
            total_elegibles: resultsElection.total_eligible,
            participation_rate: resultsElection.participation_rate
        },
        publication_status: election.status == 'SCRUTINIZED' ?  'finalized_at' : 'results_available'
    };   
}
export async function submitKey(data: submitKeyDTO) {
    if (!data.member_id || !data.key_shard) {
        throw badRequest('SCRUTINY_KEY_SUBMISSION_INVALID', 'Se requiere miembro y llave de escrutinio');
    }

    await syncAutomaticStatuses();
    const election = await findElectionById(data.election_id);
    if (!election) throw notFound('SCRUTINY_ELECTION_NOT_FOUND', 'Eleccion no encontrada');
    if (!election.requires_keys) throw conflict('SCRUTINY_KEYS_NOT_REQUIRED', 'Esta eleccion no requiere llaves de escrutinio');
    if (election.status !== 'CLOSED') throw conflict('SCRUTINY_SUBMIT_ELECTION_NOT_CLOSED', 'Solo se pueden canjear llaves cuando la votacion esta cerrada');
    const keyhash = hashkey(data.key_shard);
    const result = await scrutinyRepository.checkKey(data, keyhash);
    if (!result) throw forbidden('SCRUTINY_KEY_INVALID', 'Key invalida');
    const submitResult = await scrutinyRepository.submitKeys(data);
    if(!submitResult) throw notFound('SCRUTINY_KEY_NOT_FOUND', 'No se encontro la llave de escrutinio');
    const progress = await scrutinyRepository.getScrutinyProgress(data.election_id);
    let finalized = false;
    if (progress && progress.submittedKeys >= election.min_keys) {
        try {
            const finalizedElection = await scrutinyRepository.finalizeScrutine(data.election_id, data.member_id);
            finalized = finalizedElection?.status === 'SCRUTINIZED';
        } catch (error) {
            if (!isAlreadyFinalizedError(error)) {
                throw error;
            }
            finalized = true;
        }
    }
    return {
        submitted: true,
        finalized
    };
};

export async function addMembersElection(electionId: string, data: AssingMembersDTO, cretedBy?: string) {
    await syncAutomaticStatuses();
    const election = await findElectionById(electionId);
    if (!election) throw notFound('SCRUTINY_ELECTION_NOT_FOUND', 'Eleccion no encontrada');
    if (!election.requires_keys) throw conflict('SCRUTINY_KEYS_NOT_REQUIRED', 'Esta eleccion no requiere llaves de escrutinio');
    if (election.status !== 'CLOSED') throw conflict('SCRUTINY_KEY_GENERATION_ELECTION_NOT_CLOSED', 'Las llaves de escrutinio se generan cuando la votacion esta cerrada');
    validateStudentID(data);
    const {keys, keysHash} = generateKeys(data);
    //Falta la idea de enviar la llave por medio de correos a los diferentes miembros
    const result = await scrutinyRepository.addMembersElection(electionId, data, keysHash, cretedBy);
    if (!result) throw internalError('SCRUTINY_KEYS_SAVE_FAILED', 'Error al guardar las llaves');
    
    return {result: result, keys: keys }; 
}

export async function scrutinyResult(electionId: string) {
    await syncAutomaticStatuses();
    const election = await findElectionById(electionId);
    if (!election) throw notFound('SCRUTINY_ELECTION_NOT_FOUND', 'Elección no encontrada');
    if (election.requires_keys && !['SCRUTINIZED', 'ARCHIVED'].includes(election.status)) {
        throw conflict('SCRUTINY_RESULTS_NOT_FINALIZED', 'Los resultados del escrutinio estan disponibles hasta que se marque como finalizado')
    }
    if (!election.requires_keys && !['CLOSED', 'SCRUTINIZED', 'ARCHIVED'].includes(election.status)) {
        throw conflict('SCRUTINY_RESULTS_ELECTION_NOT_CLOSED', 'Los resultados solo estan disponibles despues de cerrar la votacion')
    }
    const resultsElection = await getElectionResults(electionId);
    if (!resultsElection) throw internalError('SCRUTINY_RESULTS_FETCH_FAILED', 'No se pudieron obtener los resultados');
    return {
        id: election.id,
        title: election.title,
        total_votes: resultsElection.total_votes,
        total_elegibles: resultsElection.total_eligible,
        participation_rate: resultsElection.participation_rate,
        options: resultsElection.options 
    };
}

export async function finaleElection(election_id:string, finalizedBy?: string) {
    await syncAutomaticStatuses();
    const election = await findElectionById(election_id);
    if (election?.status === 'SCRUTINIZED') {
        return election;
    }
    try {
        return await scrutinyRepository.finalizeScrutine(election_id, finalizedBy);
    } catch (error) {
        if (!isAlreadyFinalizedError(error)) {
            throw error;
        }

        const finalizedElection = await findElectionById(election_id);
        if (!finalizedElection) {
            throw error;
        }
        return finalizedElection;
    }
}
