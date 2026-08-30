-- =========================================================
-- MIGRACION: VOLATILIDAD DE _audit_get
--
-- _audit_get lee variables de sesion, asi que nunca fue IMMUTABLE. Marcada
-- asi, PostgreSQL pliega su resultado dentro del plan que cachea para el
-- trigger y el resto de la sesion sigue viendo el primer valor leido. Sobre
-- el pool de conexiones del backend eso tiene dos consecuencias:
--
--   - Los interruptores de auditoria se quedan pegados. Una conexion que
--     acababa de correr una importacion masiva (app.bulk_import) seguia
--     silenciando eventos en las peticiones siguientes que reutilizaban esa
--     misma conexion, y lo mismo con los modos compuestos de elecciones y
--     tags.
--   - Peor: app.actor_id y app.actor_carnet salen del mismo helper, asi que
--     un evento podia quedar atribuido a la persona de la peticion anterior.
--     Para una bitacora electoral eso es un defecto de fondo: el registro
--     dice que actuo alguien que no actuo.
--
-- STABLE es la volatilidad correcta: constante dentro de una sentencia,
-- releida en la siguiente.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- =========================================================

CREATE OR REPLACE FUNCTION _audit_get(key TEXT) RETURNS TEXT AS $$
BEGIN
  RETURN current_setting(key, true);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
