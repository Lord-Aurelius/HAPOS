export type SmsRequest = {
  recipients: string[];
  message: string;
  senderId?: string;
  enqueue?: boolean;
};

export type SmsResponse = {
  message: string;
  recipients: Array<{
    number: string;
    status: string;
    statusCode: number;
    cost?: string;
    messageId?: string;
  }>;
  raw: unknown;
};

export type AfricaTalkingConfig = {
  username: string;
  apiKey: string;
  baseUrl: string;
  senderId?: string;
};

export class AfricaTalkingSmsClient {
  constructor(private readonly config: AfricaTalkingConfig) {}

  async sendSms(input: SmsRequest): Promise<SmsResponse> {
    const endpoint = `${this.config.baseUrl.replace(/\/$/, '')}/version1/messaging`;
    const form = new URLSearchParams();

    form.set('username', this.config.username);
    form.set('to', input.recipients.join(','));
    form.set('message', input.message);

    const senderId = input.senderId ?? this.config.senderId;
    if (senderId) {
      form.set('from', senderId);
    }

    if (input.enqueue) {
      form.set('enqueue', '1');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey: this.config.apiKey,
      },
      body: form.toString(),
    });

    if (!response.ok) {
      throw new Error(`Africa's Talking SMS request failed with HTTP ${response.status}.`);
    }

    const body = (await response.json()) as {
      SMSMessageData?: {
        Message?: string;
        Recipients?: Array<{
          number: string;
          status: string;
          statusCode: number;
          cost?: string;
          messageId?: string;
        }>;
      };
    };

    return {
      message: body.SMSMessageData?.Message ?? 'Unknown provider response',
      recipients: body.SMSMessageData?.Recipients ?? [],
      raw: body,
    };
  }
}
