import {
  CalendarDatabase,
  handleCalendarRequest,
} from "./calendar-service";

interface Env {
  DB: CalendarDatabase;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
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
