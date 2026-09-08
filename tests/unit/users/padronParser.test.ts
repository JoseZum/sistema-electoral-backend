import { describe, it, expect } from 'vitest';
import type { Sheet, Row } from 'read-excel-file/node';
import {
  analyzeWorkbook,
  applyMapping,
  detectHeaderRow,
  detectMapping,
  buildColumns,
  type PadronCatalog,
} from '../../../src/modules/users/services/padronParser';

// Sedes y carreras reales del padrón: la inferencia por contenido las usa para
// reconocer columnas cuyo encabezado no dice nada útil.
const CATALOG: PadronCatalog = {
  sedes: [
    'CAMPUS TECNOLOGICO CENTRAL CARTAGO',
    'CAMPUS TECNOLOGICO LOCAL SAN CARLOS',
    'CENTRO ACADEMICO DE ALAJUELA',
  ],
  careers: [
    'INGENIERÍA EN COMPUTACIÓN',
    'INGENIERÍA EN MANTENIMIENTO INDUSTRIAL',
    'ADMINISTRACIÓN DE EMPRESAS',
  ],
};

function sheet(data: Row[], name = 'Hoja1'): Sheet[] {
  return [{ sheet: name, data }];
}

const HEADERS = ['carne', 'nombre', 'correo', 'sede', 'carrera', 'grado'];

const ANA: Row = [
  2021001234,
  'GARCIA MORA ANA LUCIA',
  'a.garcia@estudiantec.cr',
  'CAMPUS TECNOLOGICO CENTRAL CARTAGO',
  'INGENIERÍA EN COMPUTACIÓN',
  '119410055',
];

const BRUNO: Row = [
  2022005678,
  'MORA SOLIS BRUNO',
  'b.mora@estudiantec.cr',
  'CENTRO ACADEMICO DE ALAJUELA',
  'ADMINISTRACIÓN DE EMPRESAS',
  '118220033',
];

describe('padronParser · detección de la fila de encabezados', () => {
  it('encuentra el encabezado en la fila 4 del formato institucional', () => {
    const data: Row[] = [[], [], [], HEADERS, ANA];
    expect(detectHeaderRow(data).index).toBe(3);
  });

  // Este es el caso que rompía el importador anterior: daba la fila 4 por
  // sentada, así que un archivo normal perdía todas sus filas.
  it('encuentra el encabezado en la fila 1', () => {
    const data: Row[] = [HEADERS, ANA, BRUNO];
    expect(detectHeaderRow(data).index).toBe(0);
  });

  it('salta las filas de título antes del encabezado', () => {
    const data: Row[] = [
      ['Tribunal Electoral Estudiantil'],
      ['Padrón oficial'],
      ['Generado el 2026-09-07'],
      [],
      [],
      [],
      HEADERS,
      ANA,
    ];
    expect(detectHeaderRow(data).index).toBe(6);
  });

  it('reconoce un archivo que arranca directo con datos', () => {
    const { index } = detectHeaderRow([ANA, BRUNO]);
    expect(index).toBe(-1);
  });

  it('ofrece candidatos alternativos para que el admin corrija', () => {
    const data: Row[] = [['Reporte'], HEADERS, ANA];
    const { candidates } = detectHeaderRow(data);
    expect(candidates.map((candidate) => candidate.index)).toContain(1);
  });
});

describe('padronParser · mapeo por nombre de columna', () => {
  it('mapea los encabezados del padrón institucional', () => {
    const columns = buildColumns([HEADERS, ANA], 0);
    const { mapping, source } = detectMapping(columns, CATALOG);

    expect(mapping).toEqual({
      carnet: 0,
      full_name: 1,
      email: 2,
      sede: 3,
      career: 4,
      degree_level: 5,
    });
    expect(source.carnet).toBe('header');
  });

  it('acepta encabezados que el importador anterior no conocía', () => {
    const headers = [
      'Identificación',
      'Estudiante',
      'Correo institucional',
      'Recinto',
      'Escuela',
      'Cédula',
    ];
    const columns = buildColumns([headers, ANA], 0);
    const { mapping } = detectMapping(columns, CATALOG);

    expect(mapping).toEqual({
      carnet: 0,
      full_name: 1,
      email: 2,
      sede: 3,
      career: 4,
      degree_level: 5,
    });
  });

  it('no depende del orden de las columnas', () => {
    const headers = ['Correo', 'Carrera', 'Carnet', 'Sede', 'Nombre completo'];
    const row: Row = [
      'a.garcia@estudiantec.cr',
      'INGENIERÍA EN COMPUTACIÓN',
      2021001234,
      'CAMPUS TECNOLOGICO CENTRAL CARTAGO',
      'GARCIA MORA ANA LUCIA',
    ];
    const { mapping } = detectMapping(buildColumns([headers, row], 0), CATALOG);

    expect(mapping).toEqual({
      email: 0,
      career: 1,
      carnet: 2,
      sede: 3,
      full_name: 4,
    });
  });

  it('tolera tildes, mayúsculas y espacios sobrantes en el encabezado', () => {
    const headers = ['  CARNÉ ', 'Nombre Completo', 'CORREO ELECTRÓNICO'];
    const { mapping } = detectMapping(buildColumns([headers, ANA], 0), CATALOG);

    expect(mapping.carnet).toBe(0);
    expect(mapping.full_name).toBe(1);
    expect(mapping.email).toBe(2);
  });

  it('reconoce un encabezado que contiene el alias dentro de una frase', () => {
    const headers = ['Número de carnet del estudiante', 'Nombre', 'Correo'];
    const { mapping } = detectMapping(buildColumns([headers, ANA], 0), CATALOG);

    expect(mapping.carnet).toBe(0);
  });
});

describe('padronParser · inferencia por contenido', () => {
  it('deduce los campos de un archivo sin encabezados útiles', () => {
    const headers = ['A', 'B', 'C', 'D', 'E'];
    const rows: Row[] = [
      headers,
      ANA.slice(0, 5) as Row,
      BRUNO.slice(0, 5) as Row,
    ];
    const { mapping, source } = detectMapping(buildColumns(rows, 0), CATALOG);

    expect(mapping.carnet).toBe(0);
    expect(mapping.full_name).toBe(1);
    expect(mapping.email).toBe(2);
    expect(mapping.sede).toBe(3);
    expect(mapping.career).toBe(4);
    expect(source.email).toBe('content');
  });

  it('distingue el carnet de la cédula por el año de ingreso', () => {
    const rows: Row[] = [
      ['col1', 'col2', 'col3', 'col4'],
      ['119410055', 2021001234, 'GARCIA MORA ANA LUCIA', 'a.garcia@estudiantec.cr'],
      ['118220033', 2022005678, 'MORA SOLIS BRUNO', 'b.mora@estudiantec.cr'],
    ];
    const { mapping } = detectMapping(buildColumns(rows, 0), CATALOG);

    expect(mapping.carnet).toBe(1);
  });

  it('no adivina la sede cuando los valores no existen en el padrón', () => {
    const rows: Row[] = [
      ['col1', 'col2', 'col3', 'col4'],
      [2021001234, 'GARCIA MORA ANA LUCIA', 'a.garcia@estudiantec.cr', 'UNIVERSIDAD AJENA'],
    ];
    const { mapping } = detectMapping(buildColumns(rows, 0), CATALOG);

    expect(mapping.sede).toBeUndefined();
  });
});

describe('padronParser · normalización de filas', () => {
  const mapping = {
    carnet: 0,
    full_name: 1,
    email: 2,
    sede: 3,
    career: 4,
    degree_level: 5,
  };

  it('convierte el carnet numérico a texto sin notación científica', () => {
    const { rows } = applyMapping([HEADERS, ANA], 0, mapping);

    expect(rows[0].Carnet).toBe('2021001234');
    expect(rows[0].Nombre).toBe('GARCIA MORA ANA LUCIA');
  });

  it('usa NO_ESPECIFICADO cuando la fila no trae grado', () => {
    const row: Row = [...ANA.slice(0, 5), ''];
    const { rows } = applyMapping([HEADERS, row], 0, mapping);

    expect(rows[0].Grado).toBe('NO_ESPECIFICADO');
  });

  it('deja sede y carrera en null cuando vienen vacías', () => {
    const row: Row = [2021001234, 'GARCIA MORA ANA LUCIA', 'a.garcia@estudiantec.cr', '', '', ''];
    const { rows } = applyMapping([HEADERS, row], 0, mapping);

    expect(rows[0].Sede).toBeNull();
    expect(rows[0].Carrera).toBeNull();
  });

  it('ignora las filas completamente vacías sin contarlas como inválidas', () => {
    const { totalRows, invalidRows, validRows } = applyMapping(
      [HEADERS, ANA, [], [null, null, null], BRUNO],
      0,
      mapping
    );

    expect(totalRows).toBe(2);
    expect(validRows).toBe(2);
    expect(invalidRows).toBe(0);
  });

  it('reporta cada fila descartada con su número de Excel y el motivo', () => {
    const data: Row[] = [
      [],
      [],
      [],
      HEADERS,
      ANA,
      ['', 'SIN CARNET', 'x@estudiantec.cr', '', '', ''],
      [2023001111, '', 'y@estudiantec.cr', '', '', ''],
      [2023002222, 'SIN CORREO', '', '', '', ''],
      [2023003333, 'CORREO ROTO', 'no-es-un-correo', '', '', ''],
    ];
    const { issues, validRows, invalidRows } = applyMapping(data, 3, mapping);

    expect(validRows).toBe(1);
    expect(invalidRows).toBe(4);
    expect(issues).toEqual([
      { row: 6, reason: 'sin carnet' },
      { row: 7, reason: 'sin nombre' },
      { row: 8, reason: 'sin correo' },
      { row: 9, reason: 'correo inválido (no-es-un-correo)' },
    ]);
  });

  // Postgres aborta el INSERT entero si el mismo carnet aparece dos veces en el
  // lote, por el ON CONFLICT (carnet) DO UPDATE de fn_import_students.
  it('deduplica carnets repetidos y se queda con la última aparición', () => {
    const repetida: Row = [
      2021001234,
      'GARCIA MORA ANA LUCIA CORREGIDA',
      'a.garcia.2@estudiantec.cr',
      'CAMPUS TECNOLOGICO CENTRAL CARTAGO',
      'INGENIERÍA EN COMPUTACIÓN',
      '119410055',
    ];
    const { rows, issues } = applyMapping([HEADERS, ANA, repetida], 0, mapping);

    expect(rows).toHaveLength(1);
    expect(rows[0].Nombre).toBe('GARCIA MORA ANA LUCIA CORREGIDA');
    expect(issues[0].reason).toContain('repetido');
  });

  // Al deduplicar, la fila reemplazada deja de existir en el lote y su correo
  // vuelve a estar libre. Si no se suelta, el siguiente estudiante que lo use se
  // descarta por un conflicto que ya no existe y, como el import reemplaza el
  // padron completo, esa persona termina inactiva.
  it('libera el correo de la fila que reemplaza a un carnet repetido', () => {
    const primera: Row = [
      2021001234,
      'GARCIA MORA ANA LUCIA',
      'a.garcia@estudiantec.cr',
      'CAMPUS TECNOLOGICO CENTRAL CARTAGO',
      'INGENIERÍA EN COMPUTACIÓN',
      '',
    ];
    const corregida: Row = [
      2021001234,
      'GARCIA MORA ANA LUCIA',
      'a.garcia.nuevo@estudiantec.cr',
      'CAMPUS TECNOLOGICO CENTRAL CARTAGO',
      'INGENIERÍA EN COMPUTACIÓN',
      '',
    ];
    // Hereda el correo que la fila anterior dejo libre.
    const heredero: Row = [
      2022005678,
      'MORA SOLIS BRUNO',
      'a.garcia@estudiantec.cr',
      'CENTRO ACADEMICO DE ALAJUELA',
      'ADMINISTRACIÓN DE EMPRESAS',
      '',
    ];

    const { rows, issues } = applyMapping([HEADERS, primera, corregida, heredero], 0, mapping);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.Carnet).sort()).toEqual(['2021001234', '2022005678']);
    expect(rows.find((row) => row.Carnet === '2022005678')?.Correo).toBe(
      'a.garcia@estudiantec.cr'
    );
    expect(issues.some((issue) => issue.reason.includes('ya lo usa el carnet'))).toBe(false);
  });

  it('descarta la segunda fila que reusa un correo de otro carnet', () => {
    const otra: Row = [
      2022009999,
      'OTRA PERSONA',
      'a.garcia@estudiantec.cr',
      'CAMPUS TECNOLOGICO CENTRAL CARTAGO',
      'INGENIERÍA EN COMPUTACIÓN',
      '',
    ];
    const { rows, issues } = applyMapping([HEADERS, ANA, otra], 0, mapping);

    expect(rows).toHaveLength(1);
    expect(issues[0].reason).toContain('ya lo usa el carnet 2021001234');
  });

  it('lee desde la primera fila cuando el archivo no trae encabezados', () => {
    const { rows } = applyMapping([ANA, BRUNO], -1, mapping);

    expect(rows).toHaveLength(2);
    expect(rows[0].Carnet).toBe('2021001234');
  });
});

describe('padronParser · analyzeWorkbook', () => {
  it('analiza el formato institucional de punta a punta', () => {
    const result = analyzeWorkbook(sheet([[], [], [], HEADERS, ANA, BRUNO]), {
      catalog: CATALOG,
    });

    expect(result.headerRowIndex).toBe(3);
    expect(result.missingRequired).toEqual([]);
    expect(result.validRows).toBe(2);
    expect(result.invalidRows).toBe(0);
    expect(result.preview[0]).toMatchObject({
      Carnet: '2021001234',
      Correo: 'a.garcia@estudiantec.cr',
    });
  });

  it('avisa cuáles campos obligatorios quedaron sin mapear', () => {
    const result = analyzeWorkbook(sheet([['carne', 'sede'], [2021001234, 'CARTAGO']]), {
      catalog: CATALOG,
    });

    expect(result.missingRequired).toEqual(expect.arrayContaining(['full_name', 'email']));
    expect(result.validRows).toBe(0);
  });

  it('elige la hoja con más filas de datos', () => {
    const sheets: Sheet[] = [
      { sheet: 'Instrucciones', data: [['Lea esto antes de importar']] },
      { sheet: 'Padrón', data: [HEADERS, ANA, BRUNO] },
    ];
    const result = analyzeWorkbook(sheets, { catalog: CATALOG });

    expect(result.sheetIndex).toBe(1);
    expect(result.sheets).toHaveLength(2);
    expect(result.validRows).toBe(2);
  });

  // Contar celdas elegiria la portada; lo que decide es cuantas filas de
  // padron rinde cada hoja.
  it('prefiere la hoja del padrón sobre una portada más larga', () => {
    const sheets: Sheet[] = [
      {
        sheet: 'Lea esto primero',
        data: [
          ['Instrucciones de uso'],
          ['No modifique la hoja siguiente'],
          ['Generado por el sistema institucional'],
          ['Contacto: registro@tec.ac.cr'],
          ['Version 3'],
        ],
      },
      { sheet: 'Padrón', data: [HEADERS, ANA, BRUNO] },
    ];
    const result = analyzeWorkbook(sheets, { catalog: CATALOG });

    expect(result.sheetIndex).toBe(1);
    expect(result.validRows).toBe(2);
  });

  it('respeta la hoja que el admin selecciona', () => {
    const sheets: Sheet[] = [
      { sheet: 'Vieja', data: [HEADERS, ANA] },
      { sheet: 'Nueva', data: [HEADERS, ANA, BRUNO] },
    ];
    const result = analyzeWorkbook(sheets, { catalog: CATALOG, sheetIndex: 0 });

    expect(result.sheetIndex).toBe(0);
    expect(result.validRows).toBe(1);
  });

  it('deja que el mapeo manual del admin pise la detección automática', () => {
    // Dos columnas de correo: el admin quiere la segunda.
    const headers = ['carne', 'nombre', 'correo', 'correo alterno'];
    const row: Row = [
      2021001234,
      'GARCIA MORA ANA LUCIA',
      'viejo@estudiantec.cr',
      'nuevo@estudiantec.cr',
    ];
    const result = analyzeWorkbook(sheet([headers, row]), {
      catalog: CATALOG,
      mapping: { carnet: 0, full_name: 1, email: 3 },
    });

    expect(result.preview[0].Correo).toBe('nuevo@estudiantec.cr');
    expect(result.mappingSource.email).toBe('manual');
  });

  it('respeta la fila de encabezados que el admin corrige', () => {
    const data: Row[] = [HEADERS, ANA, BRUNO];
    const result = analyzeWorkbook(sheet(data), { catalog: CATALOG, headerRowIndex: 1 });

    expect(result.headerRowIndex).toBe(1);
    expect(result.validRows).toBe(1);
  });

  it('no falla con un libro vacío', () => {
    const result = analyzeWorkbook(sheet([]), { catalog: CATALOG });

    expect(result.validRows).toBe(0);
    expect(result.columns).toEqual([]);
  });

  it('etiqueta las columnas sin título con su letra de Excel', () => {
    const result = analyzeWorkbook(sheet([ANA, BRUNO]), { catalog: CATALOG });

    expect(result.headerRowIndex).toBe(-1);
    expect(result.columns[0].label).toBe('Columna A');
    expect(result.columns[2].label).toBe('Columna C');
  });
});
