import type {HttpRequest} from '#types/http-request.type';
import type {HttpResponse} from '#types/http-response.type';

/**
 * Sends an HTTP request and answers the response, whatever its status (a 404 is an answer, not an error); rejects only
 * when there is no answer (network, timeout, cancelled). Lives in the runner (fetch); the core only receives the function.
 */
export type SendHttp = (request: HttpRequest) => Promise<HttpResponse>;
