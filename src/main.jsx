import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ToastProvider } from "./lib/toast.jsx";
import Toasts from "./components/Toasts.jsx";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
      <Toasts />
    </ToastProvider>
  </React.StrictMode>
);
