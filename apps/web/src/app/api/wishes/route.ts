import { circleJsonRoute } from "@/server/circle-json-route";
import { runWishes } from "@/server/wishes";

import { wishesContext } from "./context";

const MAX_WISH_BYTES = 8_192;

/** Draft, keep, witness or withdraw a wish; say a trigger happened or ended; add a subscription. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_WISH_BYTES, label: "wishes" }, (context, input) => runWishes(wishesContext(context), input));
}
