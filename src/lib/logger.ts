import { LogLevel, LogSource, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export async function logEvent(input: {
  source: LogSource;
  level?: LogLevel;
  message: string;
  codProductId?: string;
  context?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.logEvent.create({
      data: {
        source: input.source,
        level: input.level ?? LogLevel.INFO,
        message: input.message,
        codProductId: input.codProductId,
        context: input.context,
      },
    });
  } catch (error) {
    console.error('Failed to persist log event', error, input);
  }
}
