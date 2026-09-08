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
 */

export const CONSENT_VERSION = '1.0';

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

        `Por cuánto tiempo: mientras se mantenga mi vínculo con ${nombreEmpresa} y por el plazo que exija la normativa laboral aplicable. Terminado ese período, o si retiro esta autorización, mis datos biométricos son eliminados.`,

        `Declaro conocer que puedo revocar esta autorización en cualquier momento, y que en todo momento puedo ejercer los derechos de acceso, rectificación, cancelación y oposición sobre mis datos personales, dirigiéndome a ${nombreEmpresa}. Revocar la autorización no afecta la validez del tratamiento realizado antes de hacerlo.`,
    ].join('\n\n');
}

/** Los párrafos sueltos, para pintarlos en pantalla. */
export function consentParagraphs(empresa: string): string[] {
    return buildConsentText(empresa).split('\n\n');
}
