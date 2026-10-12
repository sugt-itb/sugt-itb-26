/**
 * The query layer. **One module per surface's payload**, and five conventions that
 * every module after this one follows. They were settled on
 * [#12](https://github.com/mafiefa02/sugt/issues/12) and established rather than
 * described by [#25](https://github.com/mafiefa02/sugt/issues/25).
 *
 * 1. **Every exported query function takes a caller**, and takes it first. There is
 *    no way to read or write anything here without saying who is asking.
 * 2. **The caller is three named types, not one with optional fields**
 *    (`./caller.ts`). A query narrows by naming the arm in its signature. Inspecting
 *    a handed value would be a runtime shape check, which is what the three types
 *    exist to avoid.
 * 3. **One function per screen, returning what that screen renders in one round
 *    trip.** SQL shared between two modules goes in an unexported helper beneath
 *    them; nothing is exported that a surface does not render.
 * 4. **A Staff-only surface opens with the Staff-only choke point**
 *    (`./staff-only.ts`), which throws a distinguishable typed error. The app
 *    translates it into a 403 — server-side, at the call site. This convention read
 *    *"Money opens with…"* until Jadwalkan Sesi daring, which is Staff-only and is not
 *    money — and since #180 money **reads** are open, so the guard is not about reading money
 *    either: **writing** money is Staff-only (ADR-0026 reversed ADR-0004's read half), and
 *    **arranging delivery** is Staff-only by the surface list. One guard, two reasons — see
 *    `./staff-only.ts`. Two reads are gated after all, each by a Grant: the Dashboard
 *    (ADR-0037, by its page through `canViewDashboard`) and `/keuangan`'s programme-wide table
 *    (ADR-0053, by every query through `requireGrant`).
 * 5. **A write function owns its own transaction.** Several writes are
 *    multi-statement: Rencanakan Perjadin writes `perjadin`, `group_member` and N
 *    `session` rows; a Group is replaced wholesale. The boundary belongs in the function
 *    here, never in the Server Action calling it — a Server Action that opens one has put
 *    the boundary somewhere a second caller cannot reuse. (**`arrangeOnlineSession` no longer
 *    needs one** — #318 collapsed its Session-plus-`session_teacher_name` pair to a single
 *    insert of a `delivered` row with two cohort-named Pengajar columns, so a bare insert
 *    with `on conflict do nothing` is the whole write now.)
 *
 * Validation belongs beside the write, in this package, for the rules
 * `docs/data-model.md` describes as *enforced twice by design* — chief among them
 * prose being required on a Rating of 7 or below. Keeping validation and the choke
 * point in one package is worth more than keeping a rule beside the constants it
 * reads, so those live here rather than in `@sugt/domain`. The forms import them
 * from here, which they may: `@sugt/internal` already declares `@sugt/db`.
 *
 * **This package resolves nobody.** `@sugt/internal` produces the `Person` these
 * take; see `./caller.ts`.
 */
export type { Caller, ParticipantToken, PerjadinToken, Person, ServiceCaller } from "./caller";
export {
  ACTIVITY_LOG_AKSI_FILTERS,
  activityLogAksi,
  activityLogPage,
  activityLogRincian,
  type ActivityLogAksiFilter,
  type ActivityLogEntry,
  type ActivityLogFilters,
  type ActivityLogRow,
} from "./activity-log";
export {
  delivery,
  publishedStories,
  publishedStory,
  scope,
  type ClusterDelivery,
  type DeliveryData,
  type ScopeCluster,
  type ScopeData,
  type ScopeSchool,
  type StoryDetailData,
  type StoryGalleryPhoto,
  type StoryListItem,
} from "./aggregates";
export {
  addStoryPhotos,
  ceritaIndex,
  createStory,
  deleteStoryPhoto,
  publishStory,
  setStoryCover,
  storyForEditor,
  storyPublicTargets,
  updateStory,
  withdrawStory,
  type CeritaEntry,
  type CreateStoryInput,
  type NewStoryPhoto,
  type PublishResult,
  type StoryForEditor,
  type StoryPhoto,
  type StoryPublicTargets,
  type UpdateStoryInput,
} from "./cerita";
export {
  DEFAULT_FEEDBACK_SORT,
  NO_FEEDBACK_FILTERS,
  NO_PARTICIPANT_FEEDBACK_SCOPE,
  NO_PERJADIN_FEEDBACK_FILTERS,
  NO_PERJADIN_FEEDBACK_SCOPE,
  participantFeedbackAverages,
  participantFeedbackPage,
  participantFeedbackSchools,
  perjadinFeedbackAverages,
  perjadinFeedbackPage,
  perjadinFeedbackTrips,
  type FeedbackCursor,
  type FeedbackFilters,
  type FeedbackFilterValue,
  type FeedbackParticipantType,
  type FeedbackPerjadinOption,
  type FeedbackSchoolOption,
  type FeedbackSessionOption,
  type FeedbackSort,
  type ParticipantFeedbackAverages,
  type ParticipantFeedbackRow,
  type ParticipantFeedbackScope,
  type PerjadinFeedbackAverages,
  type PerjadinFeedbackCursor,
  type PerjadinFeedbackFilters,
  type PerjadinFeedbackRow,
  type PerjadinFeedbackScope,
} from "./feedback";
export { monitoringData, type MonitoringData, type MonitoringSession } from "./monitoring";
export {
  assessmentCompletions,
  setAssessmentCompletion,
  type AssessmentCompletion,
  type SetAssessmentCompletionInput,
  type SetAssessmentCompletionResult,
} from "./assessment-completion";
export {
  pretestEditorData,
  type PretestCluster,
  type PretestEditorData,
  type PretestSchool,
} from "./pretest-editor";
export {
  addChecklistItem,
  createPreparationCard,
  deletePreparationCard,
  editPreparationCard,
  preparationCards,
  removeChecklistItem,
  reorderChecklistItems,
  setChecklistItemChecked,
  setChecklistItemJenis,
  type AddChecklistItemResult,
  type CreatePreparationCardResult,
  type DeletePreparationCardResult,
  type EditPreparationCardResult,
  type PreparationCard,
  type PreparationCardInput,
  type PreparationChecklistItem,
  type RemoveChecklistItemResult,
  type ReorderChecklistItemsResult,
  type SetChecklistItemCheckedResult,
  type SetChecklistItemJenisResult,
} from "./preparation-cards";
export {
  arrangeOnlineSession,
  arrangeOnlineSessionAt,
  arrangeOnlineSessionForm,
  type ArrangeOnlineSessionAt,
  type ArrangeOnlineSessionForm,
  type ArrangeOnlineSessionInput,
  type ArrangeOnlineSessionResult,
  type SchoolOption,
} from "./arrange-online-session";
export {
  changePerjadinPic,
  perjadinDetail,
  setPerjadinPimpinan,
  setPerjadinStaff,
  updatePerjadinDates,
  type ChangePerjadinPicResult,
  type EligibleSchool,
  type GroupMemberEntry,
  type PerjadinDatesInput,
  type PerjadinDetail,
  type PerjadinSession,
  type SetPerjadinPimpinanResult,
  type SetPerjadinStaffResult,
  type UpdatePerjadinDatesResult,
} from "./perjadin-detail";
export {
  addPerjadinTeacher,
  removePerjadinTeacher,
  renamePerjadinTeacher,
  type AddPerjadinTeacherResult,
  type RemovePerjadinTeacherResult,
  type RenamePerjadinTeacherResult,
} from "./perjadin-teachers";
export {
  addPerjadinSession,
  editPerjadinSession,
  type AddPerjadinSessionResult,
  type EditPerjadinSessionResult,
  type PerjadinSessionInput,
  type SessionPlacementRefusal,
} from "./perjadin-sessions";
export { type SchoolBookedOnAnotherPerjadin } from "./school-slot";
export { type CoveredSession } from "./covered-sessions";
export { type PerjadinNameRef } from "./perjadin-naming";
export { perjadinDirectory, type DirectoryPerjadin } from "./perjadin-directory";
export {
  myPerjadin,
  pendampingOptions,
  pendampingPerjadin,
  type MyPerjadin,
  type MyPerjadinPengajar,
  type MyPerjadinPimpinan,
  type MyPerjadinSchool,
  type MyPerjadinSession,
  type MyPerjadinStaff,
  type MyPerjadinTrip,
  type PendampingOption,
  type PendampingPerjadinResult,
} from "./my-perjadin";
export {
  togglePreparationItem,
  type TogglePreparationItemInput,
  type TogglePreparationItemResult,
} from "./perjadin-preparation";
// The resolved checklist's item shape rides on `PerjadinDetail`, `MyPerjadinTrip` and
// `DirectoryPerjadin`; the resolver itself is a helper beneath the queries, like `./group-rules.ts`.
export type { PreparationItem } from "./preparation-checklist";
export {
  addPreparationItem,
  clearPreparationItemWording,
  hidePreparationItem,
  movePreparationItem,
  removePreparationItem,
  removePreparationItemAt,
  rewordPreparationItem,
  rewordPreparationItemAt,
  showPreparationItem,
  type AddPreparationItemResult,
  type HidePreparationItemResult,
  type MovePreparationItemResult,
  type PreparationOverrideScope,
  type PreparationScope,
  type RemovePreparationItemAtResult,
  type RemovePreparationItemResult,
  type RewordPreparationItemResult,
} from "./preparation-items";
export {
  deleteSessionFootage,
  footageSession,
  recordSessionFootage,
  sessionFootageList,
  type DeleteSessionFootageResult,
  type FootageSession,
  type FootageSessionRefusal,
  type NewSessionFootage,
  type RecordSessionFootageResult,
  type SessionFootageRow,
} from "./session-footage";
export {
  claimFootageFolder,
  claimPerjadinFootageFolder,
  claimSessionFootageFolder,
  footageFolderIds,
  footageReconcileTarget,
  markFootageSynced,
  markFootageSyncFailed,
  sessionFootageFolders,
  unsyncedFootage,
  type FootageFolderIds,
  type FootageReconcileTarget,
  type PlacedFootage,
  type SessionFolderNaming,
  type SessionFootageFolder,
  type UnsyncedFootage,
} from "./session-footage-drive-sync";
export {
  preparationWeek,
  type PreparationWeek,
  type WeekPerjadin,
  type WeekPreparationItem,
} from "./preparation-week";
export {
  preparationSettings,
  preparationSettingsClusters,
  preparationSettingsPerjadins,
  type PreparationSettings,
  type PreparationSettingsItem,
  type PreparationSettingsPerjadin,
} from "./preparation-settings";
export { onlineSessionDirectory, type DirectoryOnlineSession } from "./online-session-directory";
export {
  deleteOnlineSession,
  onlineSessionDetail,
  updateOnlineSession,
  type DeleteOnlineSessionResult,
  type OnlineSessionDetail,
  type OnlineSessionInput,
  type OnlineSessionLookup,
  type UpdateOnlineSessionResult,
} from "./online-session-detail";
export {
  addPerson,
  revokePerson,
  roster,
  type AddPersonResult,
  type NewPerson,
  type RevokePersonResult,
  type RosterEntry,
} from "./roster";
export {
  filePerjadinEvaluation,
  issuePerjadinFeedbackToken,
  type FilePerjadinEvaluationResult,
  type IssuePerjadinFeedbackTokenResult,
  type NewPerjadinEvaluation,
  type PerjadinEvaluationComments,
  type PerjadinEvaluationRatings,
} from "./perjadin-evaluation";
export {
  issueFeedbackToken,
  submitParticipantFeedback,
  type IssueFeedbackTokenResult,
  type NewParticipantFeedback,
  type ParticipantFeedbackAnswers,
  type ParticipantFeedbackComments,
  type ParticipantFeedbackRatings,
  type SubmitParticipantFeedbackResult,
} from "./participant-feedback";
export {
  perjadinPlan,
  planPerjadin,
  type PerjadinPlan,
  type PlannablePerson,
  type PlannableSchool,
  type PlannableSubCluster,
  type PlannedSession,
  type PlanPerjadinInput,
  type PlanPerjadinResult,
  type SessionTimeClash,
} from "./perjadin-planning";
export {
  attachTransactionEvidence,
  deleteTransaction,
  deleteTransactionEvidence,
  perjadinAcquittal,
  receiptDeleteTarget,
  receiptsOnLine,
  recordTransaction,
  transactionDeleteTarget,
  type AcquittalEvidence,
  type AcquittalTransaction,
  type AttachEvidenceResult,
  type DeleteEvidenceResult,
  type DeleteTransactionResult,
  type ReceiptDeleteTarget,
  type NewEvidence,
  type NewTransaction,
  type PerjadinAcquittal,
  type RecordTransactionResult,
  type TransactionDriveItems,
} from "./perjadin-report";
export {
  schoolDetail,
  type SchoolDetail,
  type SchoolSession,
  type SessionAspect,
  type SessionConcern,
} from "./school-detail";
export { schoolDirectory, type DirectorySchool } from "./school-directory";
export {
  cancelSession,
  markSessionDelivered,
  moveSessionDate,
  sessionDetail,
  type CancelSessionResult,
  type MarkDeliveredResult,
  type MoveSessionDateResult,
  type OwedRecord,
  type PastArranged,
  type SessionDetail,
  type SessionPerjadin,
} from "./session-detail";
export {
  fileSessionRecord,
  type FileSessionRecordResult,
  type NewSessionRecord,
  type NotDelivered,
  type SessionRecordRatings,
} from "./session-records";
export { assignGrant, personGrants, revokeGrant, type SetGrantResult } from "./grants";
export {
  DEFAULT_KEUANGAN_SORT,
  KEUANGAN_SORT_KEYS,
  keuanganExport,
  keuanganPage,
  keuanganPerjadinOptions,
  type KeuanganFilters,
  type KeuanganPage,
  type KeuanganPerjadinOption,
  type KeuanganRow,
  type KeuanganSort,
  type KeuanganSortKey,
} from "./keuangan";
export type { DriveConnectionStatus, DriveFolderProblem } from "../schema/drive";
export {
  driveConnectionCard,
  driveCredentials,
  driveFolderIds,
  markDriveConnectionBroken,
  recordDriveFolders,
  saveDriveConnection,
  touchDriveConnection,
  type DriveConnectionCard,
  type DriveCredentials,
  type DriveFolderIds,
  type EncryptedRefreshToken,
  driveUploadState,
  type DriveUploadState,
} from "./drive-connection";
export {
  claimPerjadinDriveFolder,
  claimTransactionDriveFolder,
  markTransactionSyncFailed,
  markTransactionSynced,
  perjadinDriveFolder,
  perjadinDriveFolders,
  reconcileTarget,
  unsyncedTransactions,
  type PerjadinDriveFolder,
  type ReconcileEvidence,
  type ReconcileTarget,
  type UnsyncedTransaction,
} from "./drive-sync";
export {
  claimDocumentKindFolder,
  claimDokumenFolder,
  claimPerjadinDokumenFolder,
  documentReconcileTarget,
  dokumenFolderIds,
  markDocumentSynced,
  markDocumentSyncFailed,
  unsyncedDocuments,
  type DocumentReconcileTarget,
  type DokumenFolderIds,
  type UnsyncedDocument,
} from "./document-drive-sync";
export {
  checkDocumentFields,
  deletePerjadinDocument,
  perjadinDokumen,
  recordPerjadinDocument,
  type DeletePerjadinDocumentResult,
  type DocumentFields,
  type DocumentFieldsRefusal,
  type DocumentSchool,
  type NewPerjadinDocument,
  type PerjadinDocumentRow,
  type PerjadinDokumen,
  type PesertaFields,
  type RecordPerjadinDocumentResult,
} from "./perjadin-documents";
export {
  canViewDashboard,
  canWritePerjadin,
  hasGrant,
  isNotGrantedError,
  isNotOnPerjadinError,
  isNotStaffError,
  NotGrantedError,
  NotOnPerjadinError,
  NotStaffError,
  requireGrant,
  requirePerjadinWriter,
  requireSessionWriter,
  requireStaff,
} from "./staff-only";
export {
  createSubCluster,
  deleteSubCluster,
  moveSchool,
  renameSubCluster,
  subClusterBoard,
  type BlockingPerjadin,
  type ClusterWithSubClusters,
  type CreateSubClusterResult,
  type DeleteSubClusterResult,
  type MoveSchoolResult,
  type NewSubCluster,
  type RenameSubClusterResult,
  type SubClusterSchool,
  type SubClusterWithSchools,
} from "./sub-clusters";
