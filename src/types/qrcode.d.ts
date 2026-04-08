declare module 'qrcode' {
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

  type QrColorOptions = {
    dark?: string;
    light?: string;
  };

  type QrBaseOptions = {
    errorCorrectionLevel?: ErrorCorrectionLevel;
    margin?: number;
    color?: QrColorOptions;
  };

  type QrToBufferOptions = QrBaseOptions & {
    width?: number;
  };

  type QrToStringOptions = QrBaseOptions & {
    type?: 'svg';
  };

  const QRCode: {
    toBuffer(text: string, options?: QrToBufferOptions): Promise<Buffer>;
    toString(text: string, options?: QrToStringOptions): Promise<string>;
  };

  export default QRCode;
}
