import type { Sheet, Row, CellValue } from 'read-excel-file/node';
import type { PadronImportRow } from '../models/userModel';

/**
 * Parseo flexible del padrón estudiantil.
 *
 * El importador anterior asumía una estructura exacta: encabezados en la fila 4
 * y un puñado cerrado de nombres de columna. Cualquier archivo que se saliera de
 * ahí se descartaba entero y en silencio. Este módulo detecta la hoja, la fila de
 * encabezados y el mapeo columna → campo, y explica qué filas descarta y por qué.
 *
 * No toca la base de datos: recibe las hojas ya leídas y el catálogo de sedes y
 * carreras, y devuelve estructuras planas. Así se puede probar sin Postgres.
 */

// ── Tipos ──

export type PadronField =
  | 'carnet'
  | 'full_name'
  | 'email'
  | 'sede'
  | 'career'
  | 'degree_level';

/** Campos sin los cuales una fila no se puede importar. */
export const REQUIRED_FIELDS: readonly PadronField[] = ['carnet', 'full_name', 'email'];

export const PADRON_FIELDS: readonly PadronField[] = [
  'carnet',
  'full_name',
  'email',
  'sede',
  'career',
  'degree_level',
];

/** Cómo se resolvió el mapeo de cada campo, para que la UI pueda mostrarlo. */
export type MappingSource = 'header' | 'content' | 'manual' | 'none';

/** Campo del padrón → índice de columna dentro de la hoja. */
export type ColumnMapping = Partial<Record<PadronField, number>>;

export interface PadronCatalog {
  sedes: string[];
  careers: string[];
}

export interface SheetInfo {
  index: number;
  name: string;
  rowCount: number;
}

export interface DetectedColumn {
  index: number;
  /** Texto del encabezado, o cadena vacía si la columna no tiene título. */
  header: string;
  /** Etiqueta para la UI: el encabezado, o «Columna C» cuando no hay. */
  label: string;
  samples: string[];
}

export interface HeaderCandidate {
  /** Índice 0-based dentro de la hoja. -1 significa «el archivo no trae encabezados». */
  index: number;
  score: number;
  label: string;
}

export interface RowIssue {
  /** Número de fila tal como se ve en Excel (1-based). */
  row: number;
  reason: string;
}

/** Fila lista para `fn_import_students`, que espera estas claves exactas. */
export type PadronRow = PadronImportRow;

export interface ParseResult {
  rows: PadronRow[];
  issues: RowIssue[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

export interface AnalyzeOptions {
  catalog?: PadronCatalog;
  /** Fuerza una hoja concreta; si se omite se elige la que más filas de datos tenga. */
  sheetIndex?: number;
  /** Fuerza la fila de encabezados (0-based, o -1 para «sin encabezados»). */
  headerRowIndex?: number;
  /** Mapeo confirmado por el admin; pisa lo que detecte la heurística. */
  mapping?: ColumnMapping;
}

export interface AnalyzeResult {
  sheets: SheetInfo[];
  sheetIndex: number;
  headerRowIndex: number;
  headerRowCandidates: HeaderCandidate[];
  columns: DetectedColumn[];
  mapping: ColumnMapping;
  mappingSource: Record<PadronField, MappingSource>;
  missingRequired: PadronField[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  /** Muestra de filas descartadas, no la lista completa. */
  issues: RowIssue[];
  /** Primeras filas ya mapeadas, para que el admin verifique el mapeo de un vistazo. */
  preview: PadronRow[];
}

// Cuántas filas se inspeccionan buscando la fila de encabezados.
const HEADER_SEARCH_DEPTH = 25;
// Cuántas celdas de ejemplo se guardan por columna.
const SAMPLE_SIZE = 8;
const PREVIEW_SIZE = 10;
const MAX_REPORTED_ISSUES = 25;

// ── Normalización ──

/** Minúsculas sin tildes. Se usa para comparar valores contra el catálogo. */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .trim()
    .toLowerCase();
}

/** Como `normalizeKey` pero además sin espacios ni puntuación, para comparar encabezados. */
function normalizeHeader(value: string): string {
  return normalizeKey(value).replace(/[^a-z0-9]/g, '');
}

/** Convierte una celda a texto plano. Los carnets suelen llegar como número. */
function cellToString(value: CellValue | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    // Evita la notación científica en identificadores largos.
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  return String(value).trim();
}

function columnLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// ── Alias de encabezado ──

/**
 * Nombres de columna reconocidos por campo, ya normalizados con `normalizeHeader`.
 * El orden importa: los campos se resuelven de arriba hacia abajo, así que los
 * identificadores más específicos van primero.
 *
 * `cedula` va en `degree_level` a propósito: el padrón institucional dejó de
 * mandar el grado académico en esa columna y hoy trae la cédula (ver
 * `postulaciones/services/applicationRules.ts`).
 */
const FIELD_ALIASES: Record<PadronField, string[]> = {
  carnet: [
    'carnet', 'carne', 'nocarnet', 'numerodecarnet', 'numcarnet', 'nrocarnet',
    'ncarnet', 'carnetestudiante', 'carnetestudiantil', 'matricula', 'expediente',
    'identificacion', 'id', 'idestudiante', 'codigo', 'codigoestudiante',
    'numerodeestudiante', 'studentid', 'carneestudiante',
  ],
  full_name: [
    'nombrecompleto', 'nombreyapellidos', 'apellidosynombre', 'apellidosynombres',
    'nombredelestudiante', 'nombreestudiante', 'nombrealumno', 'nombre', 'nombres',
    'estudiante', 'alumno', 'fullname', 'name', 'persona', 'apellidosnombres',
  ],
  email: [
    'correoelectronico', 'correoinstitucional', 'correoestudiantil', 'correotec',
    'emailinstitucional', 'direccioncorreo', 'correo', 'email', 'mail', 'ecorreo',
  ],
  sede: [
    'sede', 'campus', 'recinto', 'centroacademico', 'campustecnologico',
    'sedecampus', 'sederegional', 'regional', 'nucleo', 'ubicacion',
  ],
  career: [
    'carrera', 'programaacademico', 'plandeestudios', 'unidadacademica',
    'areaacademica', 'programa', 'escuela', 'plan', 'departamento', 'career', 'major',
  ],
  degree_level: [
    'gradoacademico', 'nivelacademico', 'numerodecedula', 'nrocedula', 'cedula',
    'documento', 'datoinstitucional', 'grado', 'nivel', 'degree',
  ],
};

/** Orden en que se resuelven los campos cuando dos reclaman la misma columna. */
const RESOLUTION_ORDER: readonly PadronField[] = [
  'email',
  'carnet',
  'full_name',
  'sede',
  'career',
  'degree_level',
];

const ALL_ALIASES = new Set(Object.values(FIELD_ALIASES).flat());

function matchesAliasExactly(header: string, field: PadronField): boolean {
  return FIELD_ALIASES[field].includes(normalizeHeader(header));
}

/** Palabras del encabezado, sin tildes ni puntuación: «Correo del TEC» → [correo, del, tec]. */
function headerTokens(header: string): string[] {
  return normalizeKey(header)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Match de un alias dentro de un encabezado compuesto («Número de carnet»).
 *
 * Compara por palabras y no por subcadenas a propósito: buscar `estudiante`
 * dentro del texto crudo lo encontraría en `a.garcia@estudiantec.cr` y mandaría
 * la columna de correos al campo de nombre.
 */
function matchesAliasPartially(header: string, field: PadronField): boolean {
  const tokens = headerTokens(header);
  if (tokens.length === 0) return false;

  const aliases = FIELD_ALIASES[field];
  if (tokens.some((token) => aliases.includes(token))) return true;

  // Alias que en el encabezado vienen separados: «nombre completo», «centro academico».
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (aliases.includes(tokens[i] + tokens[i + 1])) return true;
    if (i + 2 < tokens.length && aliases.includes(tokens[i] + tokens[i + 1] + tokens[i + 2])) {
      return true;
    }
  }

  return false;
}

// ── Detección de la fila de encabezados ──

function isDataLikeRow(row: Row): boolean {
  const values = row.map(cellToString).filter(Boolean);
  if (values.length === 0) return false;
  // Un correo o un identificador largo delatan una fila de datos, no de títulos.
  return values.some((value) => value.includes('@') || /^\d{7,12}$/.test(value));
}

function scoreHeaderRow(row: Row): { score: number; aliasMatches: number } {
  const values = row.map(cellToString);
  const nonEmpty = values.filter(Boolean).length;
  const aliasMatches = values.filter(
    (value) => value && ALL_ALIASES.has(normalizeHeader(value))
  ).length;
  return { score: aliasMatches * 10 + nonEmpty, aliasMatches };
}

/**
 * Busca la fila de encabezados en las primeras filas de la hoja.
 *
 * Devuelve -1 cuando el archivo arranca directo con datos, para no perder la
 * primera fila tratándola como títulos.
 */
export function detectHeaderRow(data: Row[]): {
  index: number;
  candidates: HeaderCandidate[];
} {
  const depth = Math.min(data.length, HEADER_SEARCH_DEPTH);
  const scored: (HeaderCandidate & { aliasMatches: number })[] = [];

  for (let i = 0; i < depth; i += 1) {
    const row = data[i];
    if (!row) continue;
    const { score, aliasMatches } = scoreHeaderRow(row);
    if (score === 0) continue;
    const label = row.map(cellToString).filter(Boolean).slice(0, 4).join(' · ');
    scored.push({ index: i, score, aliasMatches, label });
  }

  scored.sort((left, right) => right.score - left.score || left.index - right.index);

  const candidates: HeaderCandidate[] = scored
    .slice(0, 3)
    .map(({ index, score, label }) => ({ index, score, label }));

  // Con dos o más encabezados reconocidos la elección es confiable.
  const confident = scored.find((candidate) => candidate.aliasMatches >= 2);
  if (confident) {
    return { index: confident.index, candidates };
  }

  // Sin encabezados reconocibles: la primera fila con contenido manda, salvo que
  // ya parezca una fila de datos.
  const firstWithContent = scored[0];
  if (!firstWithContent) {
    return { index: -1, candidates };
  }

  const row = data[firstWithContent.index];
  if (row && isDataLikeRow(row)) {
    return {
      index: -1,
      candidates: [
        { index: -1, score: 0, label: 'El archivo no trae encabezados' },
        ...candidates,
      ],
    };
  }

  return { index: firstWithContent.index, candidates };
}

// ── Columnas ──

export function buildColumns(data: Row[], headerRowIndex: number): DetectedColumn[] {
  const dataRows = data.slice(headerRowIndex + 1);
  const headerRow = headerRowIndex >= 0 ? data[headerRowIndex] || [] : [];

  const width = Math.max(
    headerRow.length,
    ...dataRows.slice(0, 50).map((row) => row.length),
    0
  );

  const columns: DetectedColumn[] = [];

  for (let index = 0; index < width; index += 1) {
    const header = cellToString(headerRow[index]);
    const samples: string[] = [];

    for (const row of dataRows) {
      if (samples.length >= SAMPLE_SIZE) break;
      const value = cellToString(row[index]);
      if (value) samples.push(value);
    }

    // Una columna sin título y sin datos no le sirve a nadie.
    if (!header && samples.length === 0) continue;

    columns.push({
      index,
      header,
      label: header || `Columna ${columnLetter(index)}`,
      samples,
    });
  }

  return columns;
}

// ── Inferencia por contenido ──

function ratio(samples: string[], predicate: (value: string) => boolean): number {
  if (samples.length === 0) return 0;
  return samples.filter(predicate).length / samples.length;
}

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const looksLikeId = (value: string) => /^\d{7,12}$/.test(value);
const looksLikeCarnet = (value: string) => /^(19|20)\d{7,8}$/.test(value);
const looksLikePersonName = (value: string) =>
  !value.includes('@') &&
  value.trim().split(/\s+/).length >= 2 &&
  /^[^0-9]+$/.test(value);

function matchesCatalog(samples: string[], entries: string[]): number {
  if (entries.length === 0) return 0;
  const normalized = new Set(entries.map(normalizeKey));
  return ratio(samples, (value) => normalized.has(normalizeKey(value)));
}

/**
 * Adivina el campo de las columnas que el nombre del encabezado no resolvió.
 *
 * Es lo que permite importar un archivo cuyas columnas se llaman «Col1, Col2…»
 * o vienen sin encabezado: el contenido delata qué es cada una. Las sedes y las
 * carreras se contrastan contra los valores que ya existen en el padrón.
 */
function inferByContent(
  columns: DetectedColumn[],
  taken: Set<number>,
  pending: Set<PadronField>,
  catalog: PadronCatalog
): Map<PadronField, number> {
  const found = new Map<PadronField, number>();
  const available = () => columns.filter((column) => !taken.has(column.index));

  const claim = (field: PadronField, column: DetectedColumn | undefined) => {
    if (!column) return;
    found.set(field, column.index);
    taken.add(column.index);
    pending.delete(field);
  };

  const best = (
    score: (column: DetectedColumn) => number,
    threshold: number
  ): DetectedColumn | undefined => {
    let winner: DetectedColumn | undefined;
    let winnerScore = threshold;
    for (const column of available()) {
      const value = score(column);
      if (value > winnerScore) {
        winner = column;
        winnerScore = value;
      }
    }
    return winner;
  };

  // El correo es el más inequívoco de todos.
  if (pending.has('email')) {
    claim('email', best((column) => ratio(column.samples, looksLikeEmail), 0.6));
  }

  // Sede y carrera se validan contra el padrón real, así que son muy fiables.
  if (pending.has('sede')) {
    claim('sede', best((column) => matchesCatalog(column.samples, catalog.sedes), 0.5));
  }
  if (pending.has('career')) {
    claim('career', best((column) => matchesCatalog(column.samples, catalog.careers), 0.5));
  }

  // Entre columnas numéricas, el carnet es el que arranca con el año de ingreso;
  // así no se confunde con la cédula.
  if (pending.has('carnet')) {
    const byYear = best((column) => ratio(column.samples, looksLikeCarnet), 0.7);
    claim('carnet', byYear || best((column) => ratio(column.samples, looksLikeId), 0.8));
  }

  if (pending.has('full_name')) {
    claim('full_name', best((column) => ratio(column.samples, looksLikePersonName), 0.6));
  }

  // `degree_level` no se infiere: es opcional y adivinarlo mal ensucia el padrón.
  return found;
}

// ── Mapeo ──

export function detectMapping(
  columns: DetectedColumn[],
  catalog: PadronCatalog = { sedes: [], careers: [] }
): { mapping: ColumnMapping; source: Record<PadronField, MappingSource> } {
  const mapping: ColumnMapping = {};
  const source = Object.fromEntries(
    PADRON_FIELDS.map((field) => [field, 'none'])
  ) as Record<PadronField, MappingSource>;

  const taken = new Set<number>();

  // Primera pasada: el encabezado coincide exactamente con un alias conocido.
  for (const field of RESOLUTION_ORDER) {
    const column = columns.find(
      (candidate) => !taken.has(candidate.index) && matchesAliasExactly(candidate.header, field)
    );
    if (column) {
      mapping[field] = column.index;
      source[field] = 'header';
      taken.add(column.index);
    }
  }

  // Segunda pasada: el encabezado contiene un alias («Correo institucional TEC»).
  for (const field of RESOLUTION_ORDER) {
    if (mapping[field] !== undefined) continue;
    const column = columns.find(
      (candidate) => !taken.has(candidate.index) && matchesAliasPartially(candidate.header, field)
    );
    if (column) {
      mapping[field] = column.index;
      source[field] = 'header';
      taken.add(column.index);
    }
  }

  // Tercera pasada: lo que quede, por el contenido de las celdas.
  const pending = new Set(PADRON_FIELDS.filter((field) => mapping[field] === undefined));
  if (pending.size > 0) {
    const inferred = inferByContent(columns, taken, pending, catalog);
    for (const [field, index] of inferred) {
      mapping[field] = index;
      source[field] = 'content';
    }
  }

  return { mapping, source };
}

// ── Aplicación del mapeo ──

function describeInvalidRow(row: PadronRow): string | null {
  if (!row.Carnet) return 'sin carnet';
  if (!row.Nombre) return 'sin nombre';
  if (!row.Correo) return 'sin correo';
  if (!looksLikeEmail(row.Correo)) return `correo inválido (${row.Correo})`;
  return null;
}

/**
 * Convierte las filas de la hoja en filas del padrón usando el mapeo dado.
 *
 * Deduplica por carnet: `fn_import_students` hace `ON CONFLICT (carnet) DO UPDATE`
 * y Postgres aborta el INSERT completo si el mismo carnet aparece dos veces en el
 * lote. Gana la última aparición, que es la que el archivo trae más actualizada.
 */
export function applyMapping(
  data: Row[],
  headerRowIndex: number,
  mapping: ColumnMapping
): ParseResult {
  const issues: RowIssue[] = [];
  const byCarnet = new Map<string, PadronRow>();
  const carnetFirstSeenAt = new Map<string, number>();
  const emailOwner = new Map<string, string>();

  const read = (row: Row, field: PadronField): string => {
    const index = mapping[field];
    if (index === undefined) return '';
    return cellToString(row[index]);
  };

  const dataRows = data.slice(headerRowIndex + 1);
  let totalRows = 0;

  dataRows.forEach((row, offset) => {
    // Número de fila tal como se ve en Excel, para que el admin la ubique.
    const excelRow = headerRowIndex + offset + 2;

    const isEmpty = row.every((cell) => cellToString(cell) === '');
    if (isEmpty) return;

    totalRows += 1;

    const parsed: PadronRow = {
      Carnet: read(row, 'carnet'),
      Nombre: read(row, 'full_name'),
      Correo: read(row, 'email'),
      Sede: read(row, 'sede') || null,
      Carrera: read(row, 'career') || null,
      Grado: read(row, 'degree_level') || 'NO_ESPECIFICADO',
    };

    const problem = describeInvalidRow(parsed);
    if (problem) {
      issues.push({ row: excelRow, reason: problem });
      return;
    }

    const emailKey = parsed.Correo.toLowerCase();
    const previousOwner = emailOwner.get(emailKey);
    if (previousOwner !== undefined && previousOwner !== parsed.Carnet) {
      issues.push({
        row: excelRow,
        reason: `el correo ${parsed.Correo} ya lo usa el carnet ${previousOwner}`,
      });
      return;
    }

    const replaced = byCarnet.get(parsed.Carnet);
    if (replaced) {
      issues.push({
        row: excelRow,
        reason: `carnet ${parsed.Carnet} repetido (fila ${carnetFirstSeenAt.get(parsed.Carnet)}); se usa esta`,
      });
      // La fila reemplazada ya no va en el lote, asi que su correo vuelve a
      // estar libre. Sin esto, el siguiente estudiante que lo use se descarta
      // por un conflicto que ya no existe y, como el import reemplaza el padron
      // completo, esa persona terminaria inactiva.
      emailOwner.delete(replaced.Correo.toLowerCase());
    } else {
      carnetFirstSeenAt.set(parsed.Carnet, excelRow);
    }

    emailOwner.set(emailKey, parsed.Carnet);
    byCarnet.set(parsed.Carnet, parsed);
  });

  const rows = [...byCarnet.values()];

  return {
    rows,
    issues,
    totalRows,
    validRows: rows.length,
    invalidRows: totalRows - rows.length,
  };
}

// ── Selección de hoja ──

/** Analiza una hoja de punta a punta con la detección automática. */
function inspectSheet(data: Row[], catalog: PadronCatalog) {
  const detected = detectHeaderRow(data);
  const columns = buildColumns(data, detected.index);
  const { mapping, source } = detectMapping(columns, catalog);
  const parsed = applyMapping(data, detected.index, mapping);
  return { detected, columns, mapping, source, parsed };
}

/**
 * Elige la hoja que rinde más filas de padrón, no la que tiene más celdas.
 *
 * Contar filas eligiría la portada o la hoja de instrucciones de un libro que
 * trae el padrón en la segunda hoja, que es un formato común.
 */
function pickSheet(sheets: Sheet[], catalog: PadronCatalog, requested?: number): number {
  if (requested !== undefined && requested >= 0 && requested < sheets.length) {
    return requested;
  }

  let bestIndex = 0;
  let bestScore = -1;

  sheets.forEach((sheet, index) => {
    const { parsed } = inspectSheet(sheet.data, catalog);
    if (parsed.validRows > bestScore) {
      bestIndex = index;
      bestScore = parsed.validRows;
    }
  });

  return bestIndex;
}

// ── Entrada principal ──

/**
 * Analiza el libro y devuelve todo lo que la pantalla de mapeo necesita:
 * estructura del archivo, mapeo propuesto y una vista previa de cómo quedarían
 * las filas. No escribe nada.
 */
export function analyzeWorkbook(
  sheets: Sheet[],
  options: AnalyzeOptions = {}
): AnalyzeResult {
  const catalog = options.catalog ?? { sedes: [], careers: [] };

  const sheetInfos: SheetInfo[] = sheets.map((sheet, index) => ({
    index,
    name: sheet.sheet || `Hoja ${index + 1}`,
    rowCount: sheet.data.filter((row) =>
      row.some((cell) => cellToString(cell) !== '')
    ).length,
  }));

  const sheetIndex = pickSheet(sheets, catalog, options.sheetIndex);
  const data = sheets[sheetIndex]?.data ?? [];

  const detected = detectHeaderRow(data);
  const headerRowIndex =
    options.headerRowIndex !== undefined ? options.headerRowIndex : detected.index;

  const columns = buildColumns(data, headerRowIndex);

  let mapping: ColumnMapping;
  let mappingSource: Record<PadronField, MappingSource>;

  if (options.mapping) {
    mapping = options.mapping;
    mappingSource = Object.fromEntries(
      PADRON_FIELDS.map((field) => [
        field,
        mapping[field] !== undefined ? 'manual' : 'none',
      ])
    ) as Record<PadronField, MappingSource>;
  } else {
    const auto = detectMapping(columns, catalog);
    mapping = auto.mapping;
    mappingSource = auto.source;
  }

  const parsed = applyMapping(data, headerRowIndex, mapping);

  return {
    sheets: sheetInfos,
    sheetIndex,
    headerRowIndex,
    headerRowCandidates: detected.candidates,
    columns,
    mapping,
    mappingSource,
    missingRequired: REQUIRED_FIELDS.filter((field) => mapping[field] === undefined),
    totalRows: parsed.totalRows,
    validRows: parsed.validRows,
    invalidRows: parsed.invalidRows,
    issues: parsed.issues.slice(0, MAX_REPORTED_ISSUES),
    preview: parsed.rows.slice(0, PREVIEW_SIZE),
  };
}

/** Parsea el libro con un mapeo ya confirmado. */
export function parseWorkbook(
  sheets: Sheet[],
  sheetIndex: number,
  headerRowIndex: number,
  mapping: ColumnMapping
): ParseResult {
  const data = sheets[sheetIndex]?.data ?? [];
  return applyMapping(data, headerRowIndex, mapping);
}
