import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import HomePage from "../app/page";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HomePage />
  </StrictMode>,
);
