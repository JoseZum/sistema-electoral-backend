import * as scrutinyRepository from '../repositories/scrutinyRepository';
import { ScrutinyInfo, AssingMembersDTO, submitKeyDTO} from '../models/scrutiny.types';
import { withAuditContext } from '../../../config/audit-context';
import { PoolClient } from 'pg';
import { syncAutomaticStatuses, findElectionById, getElectionResults } from '../../elections/repositories/electionRepository';
import {randomInt, randomBytes, createHash } from 'crypto';


function validateStudentID(listMembers: AssingMembersDTO){
    if (new Set(listMembers.students_id).size !== listMembers.students_id.length) 
        throw new Error('No se permiten id de usuario duplicados');
}

function generateAlfaNumkeys():string{
    return randomBytes(8).toString('hex').substring(0, 8)
}

function hashkey(key: string){
    return createHash('sha256').update(key).digest('hex');
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
    if (!election) throw new Error('Elección no encontrada');
    const resultsElection = await getElectionResults(electionId);
    if(!resultsElection) throw new Error('No se pudieron obtener los resultados');
    const progresElection = await scrutinyRepository.getScrutinyProgress(electionId);
    if (!progresElection) throw new Error('No se pudiero obtener el progreso de la elección');
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
    await syncAutomaticStatuses();
    const election = await findElectionById(data.election_id);
    if (!election) throw new Error('Eleccion no encontrada');
    if (!election.requires_keys) throw new Error('Esta eleccion no requiere llaves de escrutinio');
    if (election.status !== 'CLOSED') throw new Error('Solo se pueden canjear llaves cuando la votacion esta cerrada');
    const keyhash = hashkey(data.key_shard);
    const result = await scrutinyRepository.checkKey(data, keyhash);
    if (!result) throw new Error('Key invalida');
    const submitResult = await scrutinyRepository.submitKeys(data);
    if(!submitResult) throw new Error('No se encontro la llave de escrutinio');
    const progress = await scrutinyRepository.getScrutinyProgress(data.election_id);
    let finalized = false;
    if (progress && progress.submittedKeys >= election.min_keys) {
        const finalizedElection = await scrutinyRepository.finalizeScrutine(data.election_id, data.member_id);
        finalized = finalizedElection?.status === 'SCRUTINIZED';
    }
    return {
        submitted: true,
        finalized
    };
};

export async function addMembersElection(electionId: string, data: AssingMembersDTO, cretedBy?: string) {
    await syncAutomaticStatuses();
    const election = await findElectionById(electionId);
    if (!election) throw new Error('Eleccion no encontrada');
    if (!election.requires_keys) throw new Error('Esta eleccion no requiere llaves de escrutinio');
    if (election.status !== 'CLOSED') throw new Error('Las llaves de escrutinio se generan cuando la votacion esta cerrada');
    validateStudentID(data);
    const {keys, keysHash} = generateKeys(data);
    //Falta la idea de enviar la llave por medio de correos a los diferentes miembros
    const result = await scrutinyRepository.addMembersElection(electionId, data, keysHash, cretedBy);
    if (!result) throw new Error('Error al guardar las llaves');
    
    return {result: result, keys: keys }; 
}

export async function scrutinyResult(electionId: string) {
    await syncAutomaticStatuses();
    const election = await findElectionById(electionId);
    if (!election) throw new Error('Elección no encontrada');
    if (election.requires_keys && !['SCRUTINIZED', 'ARCHIVED'].includes(election.status)) {
        throw new Error('Los resultados del escrutinio estan disponibles hasta que se marque como finalizado')
    }
    if (!election.requires_keys && !['CLOSED', 'SCRUTINIZED', 'ARCHIVED'].includes(election.status)) {
        throw new Error('Los resultados solo estan disponibles despues de cerrar la votacion')
    }
    const resultsElection = await getElectionResults(electionId);
    if (!resultsElection) throw new Error('No se pudieron obtener los resultados');
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
    return await scrutinyRepository.finalizeScrutine(election_id, finalizedBy);
}
