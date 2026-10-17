import { DeleteMessageBatchCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

export interface QueueMessage {
  id: string;
  receiptHandle: string;
  body: string;
}

export interface DestroyQueue {
  receive(): Promise<QueueMessage[]>;
  remove(messages: QueueMessage[]): Promise<void>;
}

export function createDestroyQueue(region: string, queueUrl: string): DestroyQueue {
  const sqs = new SQSClient({ region });

  return {
    async receive() {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 5,
          VisibilityTimeout: 60,
        }),
      );
      return (res.Messages ?? []).flatMap((m) =>
        m.MessageId !== undefined && m.ReceiptHandle !== undefined && m.Body !== undefined
          ? [{ id: m.MessageId, receiptHandle: m.ReceiptHandle, body: m.Body }]
          : [],
      );
    },

    async remove(messages) {
      if (messages.length === 0) return;
      await sqs.send(
        new DeleteMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: messages.map((m, index) => ({ Id: String(index), ReceiptHandle: m.receiptHandle })),
        }),
      );
    },
  };
}
