import {
  CalendarDatabase,
  handleCalendarRequest,
} from "./calendar-service";
import {
  FlightStatusEnvironment,
  handleFlightStatusRequest,
} from "./flight-status";
import { collectFlightLearning, handleLearningRequest } from "./flight-learning";
import { handlePlanesRequest } from "./planes";
import { ABE_BOARD_CRON, refreshAbeAlerts, refreshAbeBoard } from "./abe-flight-board";
import {
  handlePushRequest,
  PushEnvironment,
  sendDueNotifications,
} from "./push-service";

interface Env extends PushEnvironment, FlightStatusEnvironment {
  DB: CalendarDatabase;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pushResponse = await handlePushRequest(request, env.DB, env);
    if (pushResponse) return pushResponse;
    const liveResponse = await handleFlightStatusRequest(request, env.DB, env);
    if (liveResponse) return liveResponse;
    const learningResponse = await handleLearningRequest(request, env.DB);
    if (learningResponse) return learningResponse;
    const planesResponse = await handlePlanesRequest(request);
    if (planesResponse) return planesResponse;
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
    controller: { cron: string; scheduledTime: number },
    env: Env,
    context: { waitUntil(promise: Promise<unknown>): void },
  ) {
    if (controller.cron === ABE_BOARD_CRON) {
      context.waitUntil(refreshAbeBoard(env.DB, controller.scheduledTime));
      context.waitUntil(refreshAbeAlerts(env.DB, controller.scheduledTime));
      return;
    }
    context.waitUntil(sendDueNotifications(env.DB, env, controller.scheduledTime));
    context.waitUntil(collectFlightLearning(env.DB, controller.scheduledTime));
  },
};

export default worker;
