import { describe, it, expect } from 'vitest';
import {
  assertAllowedFile,
  assertInstitutionalEmail,
  canStudentWrite,
  decodeMultipartFileName,
  detectMimeType,
  findMissingFields,
  guessNationalIdFromDegreeLevel,
  normalizeDigits,
  normalizePositionName,
  normalizeUnlockedFields,
  pickEditableData,
  resolveEditableFields,
  sanitizeFileName,
  splitFullName,
} from '../../../src/modules/postulaciones/services/applicationRules';
import {
  Application,
  ApplicationFileMeta,
} from '../../../src/modules/postulaciones/models/postulacionModel';
import { AppError } from '../../../src/errors/appError';

function buildApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    form_id: 'form-1',
    student_id: 'student-1',
    status: 'DRAFT',
    last_name_1: 'Zumbado',
    last_name_2: 'Ruiz',
    first_name: 'Jose Fabian',
    email: 'j.zumbado.1@estudiantec.cr',
    national_id: '119330447',
    carnet: '2024080534',
    phone: '88887777',
    sede: 'Cartago',
    career: 'Ingenieria en Computacion',
    position_id: null,
    unlocked_fields: null,
    correction_deadline: null,
    review_comment: null,
    reviewed_by: null,
    reviewed_at: null,
    submitted_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function buildFile(fieldKey: string): ApplicationFileMeta {
  return {
    id: `file-${fieldKey}`,
    application_id: 'app-1',
    field_key: fieldKey as ApplicationFileMeta['field_key'],
    file_name: `${fieldKey}.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 1024,
    uploaded_at: '2026-08-01T00:00:00Z',
  };
}

const ALL_REQUIRED_FILES = [
  'enrollment_report',
  'id_copy',
  'carnet_copy',
  'tdf_letter',
  'th_letter',
].map(buildFile);

describe('splitFullName', () => {
  it('parte el formato del padron APELLIDO1 APELLIDO2 NOMBRES', () => {
    expect(splitFullName('ZUMBADO RUIZ JOSE FABIAN')).toEqual({
      last_name_1: 'ZUMBADO',
      last_name_2: 'RUIZ',
      first_name: 'JOSE FABIAN',
    });
  });

  it('deja el nombre completo cuando solo hay un token', () => {
    expect(splitFullName('Prince')).toEqual({
      last_name_1: '',
      last_name_2: '',
      first_name: 'Prince',
    });
  });

  it('con dos tokens asume apellido y nombre', () => {
    expect(splitFullName('Ruiz Ana')).toEqual({
      last_name_1: 'Ruiz',
      last_name_2: '',
      first_name: 'Ana',
    });
  });

  it('tolera nulos y espacios repetidos', () => {
    expect(splitFullName(null)).toEqual({ last_name_1: '', last_name_2: '', first_name: '' });
    expect(splitFullName('  A   B   C  ')).toEqual({
      last_name_1: 'A',
      last_name_2: 'B',
      first_name: 'C',
    });
  });
});

describe('guessNationalIdFromDegreeLevel', () => {
  it('prellena cuando el padron trae la cedula en la columna de grado', () => {
    expect(guessNationalIdFromDegreeLevel('11933044')).toBe('11933044');
  });

  it('normaliza guiones y espacios', () => {
    expect(guessNationalIdFromDegreeLevel('1-1933-0447')).toBe('119330447');
    expect(guessNationalIdFromDegreeLevel(' 1 1933 0447 ')).toBe('119330447');
  });

  it('devuelve vacio cuando la columna trae el grado academico de verdad', () => {
    expect(guessNationalIdFromDegreeLevel('Bachillerato')).toBe('');
    expect(guessNationalIdFromDegreeLevel('Licenciatura')).toBe('');
  });

  it('descarta numeros que no tienen pinta de cedula', () => {
    expect(guessNationalIdFromDegreeLevel('123')).toBe('');
    expect(guessNationalIdFromDegreeLevel('1234567890123456')).toBe('');
    expect(guessNationalIdFromDegreeLevel(null)).toBe('');
  });
});

describe('normalizeDigits', () => {
  it('limpia guiones y espacios como pidio el cliente', () => {
    expect(normalizeDigits('8888-7777', 'phone')).toBe('88887777');
    expect(normalizeDigits(' 1 1933 0447 ', 'national_id')).toBe('119330447');
  });

  it('rechaza cualquier otro caracter', () => {
    expect(() => normalizeDigits('8888ABCD', 'phone')).toThrowError(AppError);
    try {
      normalizeDigits('8888ABCD', 'phone');
    } catch (error) {
      expect((error as AppError).code).toBe('APPLICATION_FIELD_NOT_NUMERIC');
      expect((error as AppError).status).toBe(400);
    }
  });

  it('trata el vacio como ausencia de dato', () => {
    expect(normalizeDigits('', 'phone')).toBeNull();
    expect(normalizeDigits('   ', 'phone')).toBeNull();
    expect(normalizeDigits(null, 'phone')).toBeNull();
  });
});

describe('assertInstitutionalEmail', () => {
  it('acepta el dominio institucional y normaliza', () => {
    expect(assertInstitutionalEmail('  J.Zumbado.1@ESTUDIANTEC.CR ')).toBe(
      'j.zumbado.1@estudiantec.cr'
    );
  });

  it('rechaza cualquier otro dominio', () => {
    expect(() => assertInstitutionalEmail('alguien@gmail.com')).toThrowError(AppError);
    expect(() => assertInstitutionalEmail(null)).toThrowError(AppError);
  });
});

describe('resolveEditableFields', () => {
  it('en borrador deja editar todo menos el correo', () => {
    const fields = resolveEditableFields(buildApplication({ status: 'DRAFT' }), {
      allow_other_documents: false,
    });

    expect(fields).toContain('last_name_1');
    expect(fields).toContain('carnet_copy');
    expect(fields).not.toContain('email');
  });

  it('oculta "otros documentos" si el admin no los habilito', () => {
    const sin = resolveEditableFields(null, { allow_other_documents: false });
    const con = resolveEditableFields(null, { allow_other_documents: true });

    expect(sin).not.toContain('other');
    expect(con).toContain('other');
  });

  it('en CONDITIONED solo devuelve los campos que el admin desbloqueo', () => {
    const fields = resolveEditableFields(
      buildApplication({ status: 'CONDITIONED', unlocked_fields: ['last_name_2', 'carnet_copy'] }),
      { allow_other_documents: false }
    );

    expect(fields).toEqual(['last_name_2', 'carnet_copy']);
  });

  it('solo ofrece el puesto si el formulario define alguno', () => {
    const sin = resolveEditableFields(null, { allow_other_documents: false }, false);
    const con = resolveEditableFields(null, { allow_other_documents: false }, true);

    expect(sin).not.toContain('position_id');
    expect(con).toContain('position_id');
  });

  it('respeta el puesto entre los campos desbloqueados al condicionar', () => {
    const fields = resolveEditableFields(
      buildApplication({ status: 'CONDITIONED', unlocked_fields: ['position_id'] }),
      { allow_other_documents: false },
      true
    );

    expect(fields).toEqual(['position_id']);
  });

  it('no deja editar nada una vez enviada o resuelta', () => {
    for (const status of ['SUBMITTED', 'APPROVED', 'REJECTED'] as const) {
      expect(resolveEditableFields(buildApplication({ status }), { allow_other_documents: true }))
        .toEqual([]);
    }
  });
});

describe('canStudentWrite', () => {
  const openForm = { status: 'OPEN' as const, allow_other_documents: false };

  it('permite escribir un borrador con el formulario abierto', () => {
    expect(canStudentWrite(null, openForm).allowed).toBe(true);
    expect(canStudentWrite(buildApplication({ status: 'DRAFT' }), openForm).allowed).toBe(true);
  });

  it('congela la postulacion mientras esta en revision', () => {
    const result = canStudentWrite(buildApplication({ status: 'SUBMITTED' }), openForm);

    expect(result.allowed).toBe(false);
    expect(result.reason?.code).toBe('APPLICATION_ALREADY_SUBMITTED');
  });

  it('bloquea las ya resueltas', () => {
    for (const status of ['APPROVED', 'REJECTED'] as const) {
      const result = canStudentWrite(buildApplication({ status }), openForm);
      expect(result.allowed).toBe(false);
      expect(result.reason?.code).toBe('APPLICATION_ALREADY_RESOLVED');
    }
  });

  it('bloquea un borrador si el formulario ya cerro', () => {
    const result = canStudentWrite(buildApplication({ status: 'DRAFT' }), {
      status: 'CLOSED',
      allow_other_documents: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason?.code).toBe('APPLICATION_FORM_NOT_OPEN');
  });

  it('deja corregir una condicionada aunque el formulario haya cerrado', () => {
    const result = canStudentWrite(
      buildApplication({
        status: 'CONDITIONED',
        correction_deadline: '2026-09-30T23:59:00Z',
      }),
      { status: 'CLOSED', allow_other_documents: false },
      new Date('2026-09-01T00:00:00Z')
    );

    expect(result.allowed).toBe(true);
  });

  it('corta la correccion cuando vence el plazo propio', () => {
    const result = canStudentWrite(
      buildApplication({
        status: 'CONDITIONED',
        correction_deadline: '2026-09-01T00:00:00Z',
      }),
      { status: 'OPEN', allow_other_documents: false },
      new Date('2026-09-02T00:00:00Z')
    );

    expect(result.allowed).toBe(false);
    expect(result.reason?.code).toBe('APPLICATION_CORRECTION_EXPIRED');
  });
});

describe('pickEditableData', () => {
  it('descarta todo campo que no este desbloqueado', () => {
    const result = pickEditableData(
      { last_name_1: 'HACKEADO', last_name_2: 'Corregido', phone: '11111111' },
      ['last_name_2']
    );

    expect(result).toEqual({ last_name_2: 'Corregido' });
  });

  it('devuelve vacio si no hay nada editable', () => {
    expect(pickEditableData({ first_name: 'X' }, [])).toEqual({});
  });
});

describe('findMissingFields', () => {
  it('no reporta nada cuando todo esta completo', () => {
    expect(findMissingFields(buildApplication(), ALL_REQUIRED_FILES)).toEqual([]);
  });

  it('lista los datos y los adjuntos que faltan', () => {
    const missing = findMissingFields(
      buildApplication({ phone: null, sede: '   ' }),
      [buildFile('enrollment_report')]
    );

    expect(missing).toContain('Número de teléfono');
    expect(missing).toContain('Sede');
    expect(missing).toContain('Copia de la identificación');
    expect(missing).not.toContain('Informe de matrícula');
  });

  it('exige elegir puesto solo si el formulario define alguno', () => {
    const sinPuesto = buildApplication({ position_id: null });

    expect(findMissingFields(sinPuesto, ALL_REQUIRED_FILES, false)).toEqual([]);
    expect(findMissingFields(sinPuesto, ALL_REQUIRED_FILES, true)).toEqual([
      'Puesto al que se postula',
    ]);
  });

  it('no reporta el puesto cuando ya fue elegido', () => {
    const conPuesto = buildApplication({ position_id: 'puesto-1' });
    expect(findMissingFields(conPuesto, ALL_REQUIRED_FILES, true)).toEqual([]);
  });

  it('no exige el adjunto opcional de otros documentos', () => {
    expect(findMissingFields(buildApplication(), ALL_REQUIRED_FILES)).not.toContain(
      'Otros documentos'
    );
  });
});

describe('deteccion de tipo de archivo', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(20)]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(20),
  ]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
  const webp = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.alloc(4),
    Buffer.from('WEBP'),
    Buffer.alloc(20),
  ]);

  it('reconoce los formatos permitidos por sus magic bytes', () => {
    expect(detectMimeType(pdf)).toBe('application/pdf');
    expect(detectMimeType(png)).toBe('image/png');
    expect(detectMimeType(jpeg)).toBe('image/jpeg');
    expect(detectMimeType(webp)).toBe('image/webp');
  });

  it('rechaza un ejecutable renombrado a .pdf', () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(20)]);

    expect(detectMimeType(exe)).toBeNull();
    expect(() => assertAllowedFile(exe, 'malicioso.pdf')).toThrowError(AppError);
  });

  it('rechaza archivos demasiado cortos para tener cabecera', () => {
    expect(detectMimeType(Buffer.from('%PDF'))).toBeNull();
  });

  it('devuelve el tipo detectado, no el declarado', () => {
    expect(assertAllowedFile(png, 'documento.pdf')).toBe('image/png');
  });
});

describe('decodeMultipartFileName', () => {
  it('recupera las tildes que multer entrega en latin1', () => {
    // Asi es exactamente como llega "identificación.pdf" desde busboy.
    const comoLlegaDeMulter = Buffer.from('identificación.pdf', 'utf8').toString('latin1');

    expect(comoLlegaDeMulter).not.toBe('identificación.pdf');
    expect(decodeMultipartFileName(comoLlegaDeMulter)).toBe('identificación.pdf');
  });

  it('deja intacto un nombre ASCII', () => {
    expect(decodeMultipartFileName('matricula.pdf')).toBe('matricula.pdf');
  });

  it('devuelve el original si los bytes no son UTF-8 valido', () => {
    const invalido = 'archivoÿþ.pdf';
    expect(decodeMultipartFileName(invalido)).toBe(invalido);
  });

  it('tolera el vacio', () => {
    expect(decodeMultipartFileName('')).toBe('');
  });
});

describe('sanitizeFileName', () => {
  it('neutraliza intentos de path traversal', () => {
    expect(sanitizeFileName('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFileName('..\\..\\windows\\system32')).not.toContain('\\');
  });

  it('quita comillas para no romper el Content-Disposition', () => {
    expect(sanitizeFileName('a"b.pdf')).not.toContain('"');
  });

  it('conserva acentos y caracteres normales', () => {
    expect(sanitizeFileName('matrícula (2026).pdf')).toBe('matrícula (2026).pdf');
  });

  it('nunca devuelve vacio', () => {
    expect(sanitizeFileName('')).toBe('archivo');
  });

  it('recorta nombres desmedidos', () => {
    expect(sanitizeFileName('a'.repeat(300)).length).toBeLessThanOrEqual(120);
  });
});

describe('normalizePositionName', () => {
  it('recorta espacios sobrantes', () => {
    expect(normalizePositionName('  Presidencia  ')).toBe('Presidencia');
    expect(normalizePositionName('Secretaria   General')).toBe('Secretaria General');
  });

  it('rechaza un nombre vacio', () => {
    expect(() => normalizePositionName('   ')).toThrowError(AppError);
    expect(() => normalizePositionName(null)).toThrowError(AppError);
  });

  it('rechaza un nombre desmedido', () => {
    expect(() => normalizePositionName('a'.repeat(121))).toThrowError(AppError);
  });
});

describe('normalizeUnlockedFields', () => {
  it('descarta claves inventadas', () => {
    expect(normalizeUnlockedFields(['last_name_2', 'campo_inventado', 'carnet_copy'])).toEqual([
      'last_name_2',
      'carnet_copy',
    ]);
  });

  it('nunca permite desbloquear el correo', () => {
    expect(normalizeUnlockedFields(['email', 'phone'])).toEqual(['phone']);
  });

  it('permite desbloquear el puesto', () => {
    expect(normalizeUnlockedFields(['position_id'])).toEqual(['position_id']);
  });

  it('elimina duplicados y tolera entradas invalidas', () => {
    expect(normalizeUnlockedFields(['phone', 'phone'])).toEqual(['phone']);
    expect(normalizeUnlockedFields(null)).toEqual([]);
    expect(normalizeUnlockedFields(undefined)).toEqual([]);
  });
});
