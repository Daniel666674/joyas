/**
 * Every failure the API can report, with the friendly Spanish sentence the
 * customer sees. The technical `detail` is only ever logged, never sent to the
 * browser (provider messages can leak internals).
 */
export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden_origin"
  | "method_not_allowed"
  | "disabled"
  | "not_configured"
  | "not_found"
  | "image_too_large"
  | "invalid_input"
  | "content_rejected"
  | "busy"
  | "out_of_credits"
  | "provider_error"
  | "timeout";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden_origin: 403,
  method_not_allowed: 405,
  disabled: 503,
  not_configured: 503,
  not_found: 404,
  image_too_large: 413,
  invalid_input: 422,
  content_rejected: 422,
  busy: 429,
  out_of_credits: 503,
  provider_error: 502,
  timeout: 504,
};

const MESSAGE: Record<ErrorCode, string> = {
  bad_request: "No pudimos leer tu solicitud. Recarga la página e inténtalo de nuevo.",
  unauthorized: "El código de demostración no es correcto. Revísalo e inténtalo de nuevo.",
  forbidden_origin: "Este sitio no tiene permiso para usar el diseñador.",
  method_not_allowed: "Solicitud no permitida.",
  disabled: "El diseñador está en pausa por ahora. Vuelve a intentarlo más tarde.",
  not_configured: "El diseñador no está disponible en este momento.",
  not_found: "No encontramos ese diseño. Empieza uno nuevo.",
  image_too_large: "La foto es demasiado pesada. Elige una más liviana (máximo 5 MB).",
  invalid_input: "No pudimos procesar esa imagen. Usa una foto nítida en JPG o PNG.",
  content_rejected:
    "No pudimos usar esta imagen. Prueba con otra foto más clara de tu mascota, sin personas ni texto.",
  busy: "Hay muchas personas creando diseños ahora mismo. Espera un minuto e inténtalo de nuevo.",
  out_of_credits: "La demostración alcanzó su límite de uso. Inténtalo más tarde.",
  provider_error: "Algo falló al crear tu diseño. Inténtalo de nuevo en unos minutos.",
  timeout: "Tu diseño tardó más de lo esperado. Inténtalo de nuevo con otra foto.",
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function friendlyMessage(code: ErrorCode): string {
  return MESSAGE[code];
}
