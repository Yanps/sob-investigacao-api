export class JobsQueryDto {
  status?: 'pending' | 'processing' | 'done' | 'failed';
  phoneNumber?: string;
  limit?: number = 20;
  startAfter?: string; // document ID for cursor pagination
}
