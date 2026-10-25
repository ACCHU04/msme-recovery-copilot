"use client";

import { createContext, useContext } from "react";
import type { Viewer } from "./access";

/** The signed-in person as the server saw them on this request (display only; access is
 *  decided by middleware.ts, the backend and the database, never by this value). */
export const ViewerContext = createContext<Viewer | null>(null);
export const useViewer = () => useContext(ViewerContext);
