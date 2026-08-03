-- ═══════════════════════════════════════════════════════════════════════════
-- Feriados legales de Chile — año 2027
--
-- `public_holidays` alimenta el cálculo del FERIADO PROPORCIONAL del finiquito
-- (art. 67 y 69 del Código del Trabajo): los días se cuentan HÁBILES, el sábado
-- es siempre inhábil, y la proyección salta los festivos. Sin la tabla sembrada,
-- el cálculo cuenta de menos y **le paga menos al trabajador**.
--
-- Hay que sembrar CADA AÑO: los feriados móviles (Semana Santa) y los
-- trasladables cambian de fecha.
--
-- ⚠️ VERIFICAR ANTES DE EMITIR UN FINIQUITO CON FECHAS DE 2027.
-- Estas fechas están CALCULADAS, no copiadas de una fuente oficial:
--   · Semana Santa por algoritmo de Pascua (domingo 28-mar-2027).
--   · Traslados por la Ley 19.973: el 29 de junio y el 12 de octubre caen MARTES
--     en 2027, así que se corren al lunes de esa misma semana (28-jun y 11-oct).
--   · El 31 de octubre (Ley 20.299, Iglesias Evangélicas) cae DOMINGO, así que
--     NO se traslada: la regla sólo lo mueve si cae martes o miércoles.
-- No incluye feriados que se creen por leyes posteriores (elecciones, feriados
-- regionales o únicos), que en Chile aparecen con frecuencia.
-- Es la misma lección de ADR-011: una cifra legal deducida no es una cifra legal
-- verificada.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.public_holidays (holiday_date, name, is_irrenunciable) VALUES
    ('2027-01-01', 'Año Nuevo',                          true),
    ('2027-03-26', 'Viernes Santo',                       false),
    ('2027-03-27', 'Sábado Santo',                        false),
    ('2027-05-01', 'Día Nacional del Trabajo',            true),
    ('2027-05-21', 'Día de las Glorias Navales',          false),
    ('2027-06-28', 'San Pedro y San Pablo (trasladado)',  false),
    ('2027-07-16', 'Virgen del Carmen',                   false),
    ('2027-08-15', 'Asunción de la Virgen',               false),
    ('2027-09-18', 'Independencia Nacional',              true),
    ('2027-09-19', 'Día de las Glorias del Ejército',     true),
    ('2027-10-11', 'Encuentro de Dos Mundos (trasladado)', false),
    ('2027-10-31', 'Día de las Iglesias Evangélicas',     false),
    ('2027-11-01', 'Día de Todos los Santos',             false),
    ('2027-12-08', 'Inmaculada Concepción',               false),
    ('2027-12-25', 'Navidad',                             true)
ON CONFLICT (holiday_date) DO NOTHING;
