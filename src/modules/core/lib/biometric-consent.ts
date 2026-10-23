/**
 * Texto del consentimiento informado para el tratamiento de datos biométricos.
 *
 * Vive acá, y no dentro de cada pantalla, porque el trabajador tiene que leer
 * EXACTAMENTE lo mismo lo acepte en su teléfono o en el computador del
 * administrador. Dos copias del texto se desincronizan a la primera corrección
 * de redacción, y ahí la constancia guardada deja de coincidir con lo que se
 * mostró.
 *
 * ⚠️ Al cambiar el texto hay que SUBIR `CONSENT_VERSION`. La constancia guarda
 * el texto completo, así que los consentimientos viejos siguen siendo válidos
 * para la redacción que su titular efectivamente leyó; la versión es lo que
 * permite saber a quién habría que volver a pedírselo.
 *
 * 1.1 (2026-10-22): el texto prometía eliminar los datos al terminar el vínculo o
 * al revocar, y nada lo hacía. Ahora sí (migración `20261102000000`), y se aclara
 * qué se conserva (la constancia y el registro de entregas).
 */

export const CONSENT_VERSION = '1.1';

/**
 * El texto NO promete que los datos se borren al terminar el trámite: Pagnol
 * conserva el patrón facial mientras dure la relación laboral, porque se usa en
 * cada entrega de pañol y en cada marca de asistencia. Declarar lo contrario
 * —como hacen las autorizaciones de un trámite de una sola vez— sería falso, y
 * es la primera cláusula que revisa un fiscalizador.
 */
export function buildConsentText(empresa: string): string {
    const nombreEmpresa = (empresa || '').trim() || 'la empresa';
    return [
        `De conformidad con la Ley 19.628 sobre Protección de la Vida Privada y la Ley 21.719, que trata los datos biométricos como datos personales sensibles, autorizo de manera libre, informada y específica a ${nombreEmpresa} para que trate mi nombre, mi RUT, la imagen de mi cédula de identidad y mis datos biométricos derivados de mi imagen facial.`,

        `Finalidad: verificar y validar mi identidad dentro de la plataforma Pagnol. En concreto, para acreditar quién retira y devuelve materiales y equipos en pañol, para registrar mi asistencia, y para emitir y recuperar mis credenciales de acceso.`,

        `Qué se guarda: una plantilla matemática derivada de mi rostro (un conjunto de valores numéricos, del cual no es posible reconstruir mi fotografía), junto con la selfie y las imágenes de mi cédula que entregué en este proceso. La plantilla se almacena cifrada en el servidor y no es visible para otros trabajadores ni para mis compañeros de faena.`,

        `Por cuánto tiempo: mientras se mantenga mi vínculo con ${nombreEmpresa}. Al terminar mi relación con la empresa, o si retiro esta autorización, se eliminan la plantilla de mi rostro, mi selfie y las imágenes de mi cédula (si en ese momento debo devolver equipos, la eliminación se hace cuando los devuelva). Se conservan la constancia de esta autorización y el registro de las entregas y devoluciones en que participé, como respaldo de lo ocurrido.`,

        `Declaro conocer que puedo revocar esta autorización en cualquier momento, y que en todo momento puedo ejercer los derechos de acceso, rectificación, cancelación y oposición sobre mis datos personales, dirigiéndome a ${nombreEmpresa}. Revocar la autorización no afecta la validez del tratamiento realizado antes de hacerlo.`,
    ].join('\n\n');
}

/** Los párrafos sueltos, para pintarlos en pantalla. */
export function consentParagraphs(empresa: string): string[] {
    return buildConsentText(empresa).split('\n\n');
}

/**
 * Segunda autorización del formato impreso: documentos y firma electrónicos
 * (Dictamen DT 789/15: consentimiento expreso; quien no acepta recibe todo en
 * papel; la copia va al correo PARTICULAR, no al institucional). Vive acá, junto
 * al texto biométrico, para que ninguno de los dos se copie a otro archivo.
 * Texto NUEVO: debe revisarlo asesoría legal antes de usarse.
 */
export const ELECTRONIC_DOCS_CONSENT_VERSION = '1.0';

export function electronicDocsParagraphs(empresa: string): string[] {
  const nombreEmpresa = (empresa || '').trim() || 'la empresa';
  return [
    `Autorizo a ${nombreEmpresa} para que los documentos derivados de mi relación laboral que se emitan en la plataforma Pagnol —en particular los comprobantes de entrega de elementos de protección personal, materiales y herramientas— sean confeccionados, procesados, firmados y enviados de manera electrónica.`,
    `Reconozco como mi firma electrónica simple el acto de identificarme en la plataforma por los medios que disponga la empresa (cédula de identidad, verificación de mi rostro u otro medio personal) y de confirmar la recepción. Cada documento queda registrado con mi nombre, RUT, fecha, hora y el medio con que me identifiqué, y puede imprimirse.`,
    `Indico mi correo electrónico PARTICULAR —no el de la empresa— para que se me envíe automáticamente una copia de cada documento. Me comprometo a avisar si cambia.`,
    `Entiendo que puedo negarme a esta modalidad, y que en ese caso mis documentos se me entregarán en papel y los firmaré de forma manuscrita, sin que ello afecte mi relación laboral. Puedo retirar esta autorización en cualquier momento.`,
  ];
}
