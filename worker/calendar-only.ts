import {
  CalendarDatabase,
  handleCalendarRequest,
} from "./calendar-service";
import { handleReferenceRequest } from "./reference-service";

interface Env {
  DB: CalendarDatabase;
  REFERENCE_OWNER_CODE?: string;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const referenceResponse = await handleReferenceRequest(request, env.DB, env);
    if (referenceResponse) return referenceResponse;
    const response = await handleCalendarRequest(request, env.DB);
    if (response) return response;
    return Response.json(
      {
        service: "Shiftdeck Calendar",
        status: "ok",
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      },
    );
  },
};

export default worker;
