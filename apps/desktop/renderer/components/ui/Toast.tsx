import { useEffect, useState } from "react";
import { subscribeToast } from "./toast";

export function ToastHost() {
  const [message, setMessage] = useState("");

  useEffect(() => subscribeToast(setMessage), []);

  const visible = message.length > 0;
  return (
    <div
      className={`shell-toast${visible ? " is-visible" : " hidden"}`}
      role="status"
      aria-live="polite"
      hidden={!visible}
    >
      {message}
    </div>
  );
}
