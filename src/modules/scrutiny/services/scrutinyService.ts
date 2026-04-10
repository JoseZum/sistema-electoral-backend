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
    if (!progresElection) throw new Error('No se pudiero obtener las keys Faltantes');
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
            can_finalize: progresElection.submittedKeys >= election.min_keys
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
    const keyhash = hashkey(data.key_shard);
    const result = await scrutinyRepository.checkKey(data, keyhash);
    if (!result) throw new Error('Key invalida');
    const submitResult = await scrutinyRepository.submitKeys(data);
    if(!submitResult) throw new Error('No se encontro la llave de escrutinio');
    return result;  
};

export async function addMembersElection(electionId: string, data: AssingMembersDTO, cretedBy?: string) {
    validateStudentID(data);
    const isDuplicated = await scrutinyRepository.checkDuplicate(data.students_id, electionId);
    if (isDuplicated) throw new Error('Existen datos duplicados');
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
    if (election.status == 'SCRUTINIZED') {
        throw new Error('Los resultados del escrutinio estan disponibles hasta que se marcaron como finalizado')
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
    return await scrutinyRepository.finalizeScrutine(election_id, finalizedBy);
}