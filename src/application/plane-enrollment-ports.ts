export interface PlaneEnrollmentRepository {
  // 只允許在既有 transaction 中配置下一個序號；失敗時與 domain state 一起回滾。
  allocateSequence(mappingId: string, now: string): number;
}
