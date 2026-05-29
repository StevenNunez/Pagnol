import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

export type AttendanceMark = 'P' | 'A' | 'D' | 'LM' | 'PSG' | 'V' | 'PP' | 'MJ' | 'ATR';

export interface ParsedWorkerRow {
  name: string;
  cargo: string;
  turnName: string;
  marks: Record<number, AttendanceMark>; // día (1-31) → marca
}

export interface ParsedSheet {
  sheetName: string;
  month: string;
  year: number;
  workers: ParsedWorkerRow[];
}

const VALID_MARKS = new Set(['P', 'A', 'D', 'LM', 'PSG', 'V', 'PP', 'MJ', 'ATR']);

function normalizeCell(val: any): string {
  if (val == null) return '';
  return String(val).trim().toUpperCase();
}

function parseMark(val: any): AttendanceMark | null {
  const s = normalizeCell(val);
  if (!s) return null;
  // Handle "P P" → "PP"
  const normalized = s.replace(/\s+/g, '');
  if (VALID_MARKS.has(normalized)) return normalized as AttendanceMark;
  if (s === 'P P') return 'PP';
  return null;
}

function parseSheet(ws: ExcelJS.Worksheet): Omit<ParsedSheet, 'sheetName'> {
  const workers: ParsedWorkerRow[] = [];
  let month = 'Desconocido';
  let year = new Date().getFullYear();
  let currentTurn = 'TURNO';

  // Detect columns: find the row that has "NOMBRE" header to map col index → day
  let dayColMap: Record<number, number> = {}; // colIndex → day number
  let nameColIdx = -1;
  let cargoColIdx = -1;

  ws.eachRow((row, rowNumber) => {
    const cells = row.values as any[]; // 1-indexed

    // Look for turn headers ("TURNO A", "TURNO B", "TURNO 4X3")
    for (let c = 1; c < cells.length; c++) {
      const v = normalizeCell(cells[c]);
      if (v.startsWith('TURNO')) { currentTurn = v; break; }
    }

    // Look for the day-header row (contains "NOMBRE" or "NOMBRE COMPLETO")
    const hasNombre = cells.some(v => normalizeCell(v).includes('NOMBRE'));
    if (hasNombre) {
      dayColMap = {};
      nameColIdx = -1;
      cargoColIdx = -1;
      cells.forEach((val, idx) => {
        const n = normalizeCell(val);
        if (n.includes('NOMBRE')) nameColIdx = idx;
        if (n === 'CARGO') cargoColIdx = idx;
        const num = parseInt(n);
        if (!isNaN(num) && num >= 1 && num <= 31) dayColMap[idx] = num;
      });
      // Try to detect month label
      ws.eachRow((r2, rn2) => {
        if (rn2 >= rowNumber - 5 && rn2 < rowNumber) {
          (r2.values as any[]).forEach(v => {
            const s = normalizeCell(v);
            const monthNames = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
            monthNames.forEach((m, i) => {
              if (s.includes(m)) {
                month = m;
                // Look for year
                const yearMatch = s.match(/\d{4}/);
                if (yearMatch) year = parseInt(yearMatch[0]);
              }
            });
          });
        }
      });
      return;
    }

    // Skip if we haven't found the header yet
    if (nameColIdx === -1 || Object.keys(dayColMap).length === 0) return;

    // Data row: must have a name
    const name = normalizeCell(cells[nameColIdx]);
    if (!name || name === 'NOMBRE' || name.length < 2) return;

    // Skip rows that look like totals
    if (name.startsWith('TOTAL') || name.startsWith('PRESENTE') || name.startsWith('AUSENTE') || name.startsWith('ACRED')) return;

    const cargo = cargoColIdx !== -1 ? normalizeCell(cells[cargoColIdx]) : '';
    const marks: Record<number, AttendanceMark> = {};

    Object.entries(dayColMap).forEach(([colIdx, day]) => {
      const mark = parseMark(cells[parseInt(colIdx)]);
      if (mark) marks[day] = mark;
    });

    if (Object.keys(marks).length > 0) {
      workers.push({ name, cargo, turnName: currentTurn, marks });
    }
  });

  return { month, year, workers };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No se recibió archivo.' }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const nodeBuffer = Buffer.from(new Uint8Array(arrayBuffer));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(nodeBuffer as any);

    const results: ParsedSheet[] = [];

    wb.eachSheet((ws) => {
      const parsed = parseSheet(ws);
      if (parsed.workers.length > 0) {
        results.push({ sheetName: ws.name, ...parsed });
      }
    });

    return NextResponse.json({ sheets: results });
  } catch (e: any) {
    console.error('parse-excel error:', e);
    return NextResponse.json({ error: e.message ?? 'Error al procesar el archivo.' }, { status: 500 });
  }
}
