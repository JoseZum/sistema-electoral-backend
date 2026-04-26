-- SCRIPT 01: ESQUEMA PRINCIPAL DE LA BASE DE DATOS
-- ============================================

-- ============================================
-- ENUMS
-- ============================================
CREATE TYPE election_status AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'SCRUTINIZED', 'ARCHIVED');
CREATE TYPE auth_method_type AS ENUM ('MICROSOFT');
CREATE TYPE voter_source_type AS ENUM ('FULL_PADRON', 'FILTERED', 'MANUAL', 'TAG');

-- ============================================
-- PADRON ESTUDIANTIL
-- ============================================
CREATE TABLE students (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carnet          TEXT NOT NULL UNIQUE,
    full_name       TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    sede            TEXT NOT NULL,
    career          TEXT NOT NULL,
    degree_level    TEXT NOT NULL,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_students_email ON students(email);
CREATE INDEX idx_students_career ON students(career);
CREATE INDEX idx_students_sede ON students(sede);
CREATE INDEX idx_students_active ON students(is_active);

-- ============================================
-- USUARIOS ADMINISTRATIVOS (TEE)
-- ============================================
CREATE TABLE admins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    students_id     UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
    position_title  TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'admin',
    permissions     JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- TAGS DE PADRON
-- ============================================
CREATE TABLE tags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    color           TEXT NOT NULL DEFAULT '#C62828'
                    CHECK (color IN (
                      '#C62828', '#AD1457', '#6A1B9A', '#4527A0',
                      '#283593', '#1565C0', '#006064', '#00695C',
                      '#2E7D32', '#BF360C', '#5D4037', '#37474F'
                    )),
    created_by      UUID REFERENCES students(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX uniq_tags_name_lower ON tags (LOWER(name));

CREATE TABLE tag_members (
    tag_id          UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tag_id, student_id)
);

CREATE INDEX idx_tag_members_tag ON tag_members(tag_id);
CREATE INDEX idx_tag_members_student ON tag_members(student_id);

-- ============================================
-- VOTACIONES / ELECCIONES
-- ============================================
CREATE TABLE elections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,
    status          election_status NOT NULL DEFAULT 'DRAFT',
    is_anonymous    BOOLEAN NOT NULL DEFAULT true,
    auth_method     auth_method_type NOT NULL DEFAULT 'MICROSOFT',
    voter_source    voter_source_type NOT NULL,
    voter_filter    JSONB,
    tag_id          UUID REFERENCES tags(id) ON DELETE SET NULL,
    starts_immediately BOOLEAN NOT NULL DEFAULT false,
    immediate_minutes INT,
    requires_keys   BOOLEAN DEFAULT false,
    min_keys        INT DEFAULT 3,
    start_time      TIMESTAMPTZ,
    end_time        TIMESTAMPTZ,
    scrutinized_at  TIMESTAMPTZ,
    created_by      UUID REFERENCES students(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_elections_immediate_minutes CHECK (
        immediate_minutes IS NULL
        OR (immediate_minutes >= 1 AND immediate_minutes <= 1440)
    )
);

CREATE INDEX idx_elections_tag_id ON elections(tag_id);

-- ============================================
-- OPCIONES DE VOTACION
-- ============================================
CREATE TABLE election_options (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    option_type     TEXT NOT NULL,
    display_order   INT NOT NULL DEFAULT 0,
    metadata        JSONB
);

-- ============================================
-- VOTANTES ELEGIBLES POR ELECCION
-- ============================================
CREATE TABLE election_voters (
    election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES students(id),
    token_used      BOOLEAN DEFAULT false,
    token_used_at   TIMESTAMPTZ,
    PRIMARY KEY (election_id, student_id)
);

CREATE INDEX idx_election_voters_election ON election_voters(election_id);
CREATE INDEX idx_election_voters_student ON election_voters(student_id);

-- ============================================
-- TOKENS INTERNOS PARA VOTO ANONIMO
-- ============================================
CREATE TABLE voting_tokens (
    election_id      UUID NOT NULL,
    student_id       UUID NOT NULL,
    token_hash       TEXT,
    token_encrypted  TEXT,
    used             BOOLEAN DEFAULT false,
    generated_at     TIMESTAMPTZ DEFAULT now(),
    used_at          TIMESTAMPTZ,
    PRIMARY KEY (election_id, student_id),
    CONSTRAINT fk_voting_tokens_voter
        FOREIGN KEY (election_id, student_id)
        REFERENCES election_voters(election_id, student_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_voting_tokens_student ON voting_tokens(student_id);
CREATE UNIQUE INDEX uniq_voting_tokens_hash ON voting_tokens(token_hash) WHERE token_hash IS NOT NULL;

-- ============================================
-- VOTOS EMITIDOS (SEPARADOS DE IDENTIDAD)
-- ============================================
CREATE TABLE votes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id),
    option_id       UUID NOT NULL REFERENCES election_options(id),
    token_hash      TEXT,
    student_id      UUID REFERENCES students(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_vote_identity CHECK (
        (token_hash IS NOT NULL AND student_id IS NULL)
        OR (token_hash IS NULL AND student_id IS NOT NULL)
    )
);

CREATE INDEX idx_votes_election ON votes(election_id);
CREATE INDEX idx_votes_election_option ON votes(election_id, option_id);
CREATE UNIQUE INDEX uniq_votes_token ON votes(token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX uniq_votes_student ON votes(election_id, student_id) WHERE student_id IS NOT NULL;

-- ============================================
-- LLAVES DE ESCRUTINIO
-- ============================================
CREATE TABLE scrutiny_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id),
    member_id       UUID NOT NULL REFERENCES students(id),
    key_shard       TEXT NOT NULL,
    has_submitted   BOOLEAN DEFAULT false,
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uniq_scrutiny_member UNIQUE (election_id, member_id)
);

-- ============================================
-- LOGS DE AUDITORIA
-- ============================================
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID,
    actor_carnet    TEXT,
    action          TEXT NOT NULL,
    resource_type   TEXT,
    resource_id     TEXT,
    details         JSONB,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============================================
-- HISTORIAL DE PADRONES CARGADOS
-- ============================================
CREATE TABLE padron_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by     UUID REFERENCES students(id),
    file_name       TEXT,
    total_records   INT,
    new_students    INT,
    removed_students INT,
    updated_students INT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
