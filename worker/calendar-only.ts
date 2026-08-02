import {
  CalendarDatabase,
  handleCalendarRequest,
} from "./calendar-service";
import { handleReferenceRequest } from "./reference-service";
import {
  handlePushRequest,
  PushEnvironment,
  sendDueNotifications,
} from "./push-service";

interface Env extends PushEnvironment {
  DB: CalendarDatabase;
  REFERENCE_OWNER_CODE?: string;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pushResponse = await handlePushRequest(request, env.DB, env);
    if (pushResponse) return pushResponse;
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
  async scheduled(
    controller: { scheduledTime: number },
    env: Env,
    context: { waitUntil(promise: Promise<unknown>): void },
  ) {
    context.waitUntil(sendDueNotifications(env.DB, env, controller.scheduledTime));
  },
};

export default worker;
