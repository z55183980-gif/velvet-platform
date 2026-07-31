import { Module } from '@nestjs/common';
import { ReconcileService } from './reconcile.service';

@Module({
  providers: [ReconcileService],
  exports: [ReconcileService],
})
export class ReconcileModule {}
