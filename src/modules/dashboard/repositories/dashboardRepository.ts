import { pool } from '../../../config/database';

export async function getStats() {
  const client = await pool.connect();

  try {
    const totalStudents = await client.query(
      'SELECT COUNT(*) FROM students'
    );

    const activeStudents = await client.query(
      'SELECT COUNT(*) FROM students WHERE is_active = true'
    );

    const totalElections = await client.query(
      'SELECT COUNT(*) FROM elections'
    );

    const openElections = await client.query(
      "SELECT COUNT(*) FROM elections WHERE status = 'OPEN'"
    );

    const votes = await client.query(
      `SELECT COALESCE(SUM(ev.votes_cast), 0) as total
       FROM (
         SELECT election_id,
           COUNT(*) FILTER (WHERE token_used = true) AS votes_cast
         FROM election_voters
         GROUP BY election_id
       ) ev`
    );

    const voters = await client.query(
      `SELECT COALESCE(SUM(ev.total_voters), 0) as total
       FROM (
         SELECT election_id,
           COUNT(*) AS total_voters
         FROM election_voters
         GROUP BY election_id
       ) ev`
    );

    const ongoingElectionsResult = await client.query(
      `SELECT
         e.id,
         e.title,
         e.start_time,
         e.end_time,
         COALESCE(ev.votes_cast, 0)::int AS votes_cast,
         COALESCE(ev.total_voters, 0)::int AS total_voters,
         CASE
           WHEN COALESCE(ev.total_voters, 0) > 0 THEN
             ROUND((COALESCE(ev.votes_cast, 0)::numeric / ev.total_voters::numeric) * 100, 1)
           ELSE 0
         END AS progress_percentage
       FROM elections e
       LEFT JOIN (
         SELECT election_id,
           COUNT(*) AS total_voters,
           COUNT(*) FILTER (WHERE token_used = true) AS votes_cast
         FROM election_voters
         GROUP BY election_id
       ) ev ON ev.election_id = e.id
       WHERE e.status = 'OPEN'
       ORDER BY e.end_time ASC NULLS LAST, e.start_time ASC NULLS LAST`
    );

    const totalVotes = Number(votes.rows[0].total);
    const totalVoters = Number(voters.rows[0].total);
    const ongoingElections = ongoingElectionsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      startTime: row.start_time,
      endTime: row.end_time,
      votesCount: Number(row.votes_cast),
      totalVoters: Number(row.total_voters),
      progressPercentage: Number(row.progress_percentage),
    }));

    const participation =
      totalVoters > 0 ? Number(((totalVotes / totalVoters) * 100).toFixed(1)) : 0;

    return {
      totalStudents: Number(totalStudents.rows[0].count),
      activeStudents: Number(activeStudents.rows[0].count),
      totalElections: Number(totalElections.rows[0].count),
      openElections: Number(openElections.rows[0].count),
      totalVotes,
      participation,
      ongoingElections,
    };
  } finally {
    client.release();
  }
}