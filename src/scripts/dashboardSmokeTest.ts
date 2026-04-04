import { pool } from '../config/database';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const ELECTION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUDENT_IDS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
];

type DashboardStats = {
  totalStudents: number;
  activeStudents: number;
  totalElections: number;
  openElections: number;
  totalVotes: number;
  participation: number;
  ongoingElections: Array<{
    id: string;
    title: string;
    startTime: string | null;
    endTime: string | null;
    votesCount: number;
    totalVoters: number;
    progressPercentage: number;
  }>;
};

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function seedData(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO students (id, carnet, full_name, email, sede, career, degree_level, is_active)
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'CARNET-DEMO-001', 'Ana Demo', 'ana.demo.dashboard@demo.test', 'Central', 'Informatica', 'Bachillerato', true),
        ('22222222-2222-2222-2222-222222222222', 'CARNET-DEMO-002', 'Luis Demo', 'luis.demo.dashboard@demo.test', 'Central', 'Electronica', 'Bachillerato', true),
        ('33333333-3333-3333-3333-333333333333', 'CARNET-DEMO-003', 'Maria Demo', 'maria.demo.dashboard@demo.test', 'Occidente', 'Administracion', 'Licenciatura', true),
        ('44444444-4444-4444-4444-444444444444', 'CARNET-DEMO-004', 'Jose Demo', 'jose.demo.dashboard@demo.test', 'Atlantico', 'Industrial', 'Bachillerato', true),
        ('55555555-5555-5555-5555-555555555555', 'CARNET-DEMO-005', 'Sofia Demo', 'sofia.demo.dashboard@demo.test', 'Central', 'Civil', 'Licenciatura', true)
      ON CONFLICT (id) DO UPDATE
      SET
        carnet = EXCLUDED.carnet,
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        sede = EXCLUDED.sede,
        career = EXCLUDED.career,
        degree_level = EXCLUDED.degree_level,
        is_active = EXCLUDED.is_active,
        updated_at = now();
    `);

    await client.query(`
      INSERT INTO elections (
        id, title, description, status, is_anonymous, auth_method, voter_source, start_time, end_time
      )
      VALUES (
        '${ELECTION_ID}',
        'Eleccion Demo Dashboard 2026',
        'Datos de prueba para validar progreso en dashboard',
        'OPEN',
        true,
        'MICROSOFT',
        'MANUAL',
        now() - interval '1 hour',
        now() + interval '2 days'
      )
      ON CONFLICT (id) DO UPDATE
      SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        is_anonymous = EXCLUDED.is_anonymous,
        auth_method = EXCLUDED.auth_method,
        voter_source = EXCLUDED.voter_source,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        updated_at = now();
    `);

    await client.query(`
      INSERT INTO election_voters (election_id, student_id, token_used, token_used_at)
      VALUES
        ('${ELECTION_ID}', '11111111-1111-1111-1111-111111111111', true, now() - interval '30 minutes'),
        ('${ELECTION_ID}', '22222222-2222-2222-2222-222222222222', true, now() - interval '20 minutes'),
        ('${ELECTION_ID}', '33333333-3333-3333-3333-333333333333', true, now() - interval '10 minutes'),
        ('${ELECTION_ID}', '44444444-4444-4444-4444-444444444444', false, null),
        ('${ELECTION_ID}', '55555555-5555-5555-5555-555555555555', false, null)
      ON CONFLICT (election_id, student_id) DO UPDATE
      SET
        token_used = EXCLUDED.token_used,
        token_used_at = EXCLUDED.token_used_at;
    `);
  } finally {
    client.release();
  }
}

async function cleanupData(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      DELETE FROM votes
      WHERE election_id = '${ELECTION_ID}'
         OR student_id IN (
           '${STUDENT_IDS[0]}',
           '${STUDENT_IDS[1]}',
           '${STUDENT_IDS[2]}',
           '${STUDENT_IDS[3]}',
           '${STUDENT_IDS[4]}'
         );
    `);

    await client.query(`DELETE FROM election_options WHERE election_id = '${ELECTION_ID}';`);

    await client.query(`
      DELETE FROM election_voters
      WHERE election_id = '${ELECTION_ID}'
         OR student_id IN (
           '${STUDENT_IDS[0]}',
           '${STUDENT_IDS[1]}',
           '${STUDENT_IDS[2]}',
           '${STUDENT_IDS[3]}',
           '${STUDENT_IDS[4]}'
         );
    `);

    await client.query(`DELETE FROM elections WHERE id = '${ELECTION_ID}';`);

    await client.query(`
      DELETE FROM students
      WHERE id IN (
        '${STUDENT_IDS[0]}',
        '${STUDENT_IDS[1]}',
        '${STUDENT_IDS[2]}',
        '${STUDENT_IDS[3]}',
        '${STUDENT_IDS[4]}'
      )
         OR email LIKE '%@demo.test'
         OR carnet LIKE 'CARNET-DEMO-%';
    `);
  } finally {
    client.release();
  }
}

async function callDashboard(): Promise<DashboardStats> {
  const response = await fetch(`${API_BASE_URL}/api/dashboard/stats`);
  if (!response.ok) {
    throw new Error(`Dashboard endpoint failed with status ${response.status}`);
  }

  return (await response.json()) as DashboardStats;
}

function validatePayload(payload: DashboardStats): void {
  const election = payload.ongoingElections.find((item) => item.id === ELECTION_ID);

  assert(Boolean(election), 'No se encontro la votacion demo en ongoingElections.');
  assert(election?.votesCount === 3, `votesCount esperado: 3, recibido: ${election?.votesCount}`);
  assert(election?.totalVoters === 5, `totalVoters esperado: 5, recibido: ${election?.totalVoters}`);
  assert(
    election?.progressPercentage === 60,
    `progressPercentage esperado: 60, recibido: ${election?.progressPercentage}`
  );
}

async function main(): Promise<void> {
  let cleanupNeeded = false;

  try {
    console.log('Seeding de datos demo...');
    await seedData();
    cleanupNeeded = true;

    console.log('Consultando endpoint dashboard...');
    const payload = await callDashboard();

    console.log('Validando respuesta...');
    validatePayload(payload);

    console.log('OK: dashboard devuelve datos esperados para votacion en curso.');
  } finally {
    if (cleanupNeeded) {
      console.log('Limpiando datos demo...');
      await cleanupData();
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error('FALLO EN SMOKE TEST:', error instanceof Error ? error.message : error);
  process.exit(1);
});
