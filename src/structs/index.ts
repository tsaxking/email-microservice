import { Struct } from "drizzle-struct/back-end";
import { createStructEventService } from "../services/struct-event";


Struct.each(createStructEventService);