import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

interface TwoFactorQrProps {
  value: string;
}

export default function TwoFactorQr({ value }: TwoFactorQrProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError(false);
    QRCode.toCanvas(canvas, value, {
      width: 184,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#211f1b", light: "#f1ece1" }
    }).catch(() => setError(true));
  }, [value]);

  if (error) {
    return <p className="field-error" role="alert">QR code unavailable. Use the setup key.</p>;
  }

  return <canvas className="two-factor-qr" ref={canvasRef} role="img" aria-label="Two-step sign-in QR code" />;
}
