-- ============================================
-- MIGRATION: Audit trigger para DELETE de elecciones
--
-- Hasta ahora solo se auditaba INSERT/UPDATE de elections.
-- Esta migracion agrega el trigger faltante para DELETE,
-- usando la misma fn_audit_log generica que ya enriquece
-- los detalles con election_title (toma el valor desde OLD).
--
-- Idempotente: usa DROP IF EXISTS antes de CREATE.
-- ============================================

DROP TRIGGER IF EXISTS trg_elections_delete ON elections;

CREATE TRIGGER trg_elections_delete
  AFTER DELETE ON elections
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('election');
