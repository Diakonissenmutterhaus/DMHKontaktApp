import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { EmailReaderWindow } from "./pages/EmailReaderWindow";
import "./styles.css";
import "./components/CalendarEventForm.css";
import { initializeTheme } from "./utils/theme";

initializeTheme();
const emailMessageId = new URLSearchParams(window.location.search).get("emailArchiveMessage");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {emailMessageId ? <EmailReaderWindow id={emailMessageId} /> : <App />}
  </React.StrictMode>
);
