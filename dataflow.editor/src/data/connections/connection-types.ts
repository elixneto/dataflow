import {
  CONNECTION_GROUPS as GROUPS,
  CONNECTION_TYPES as TYPES,
  typesByGroup as typesByGroupOf,
  type ConnectionGroup,
  type ConnectionType as TypeRules,
  type ConnectionTypeName,
} from '@dataflow/core';
import {
  Cloud,
  Database,
  FileCode,
  FolderSync,
  Globe,
  Inbox,
  KeyRound,
  Leaf,
  Lock,
  Rabbit,
  Radio,
  Send,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { siApachekafka, siGooglecloudstorage, siMongodb, siMysql, siPostgresql, siRabbitmq, type SimpleIcon } from 'simple-icons';

/*
 * The kinds of connection profile: their fields and rules come from @dataflow/core (the server validates with the same
 * ones); here only how each kind looks: its icon, its product's logo when there is one, and its group's color.
 */

export { defaultConfig, visibleFields, type ConnectionField, type ConnectionGroup, type ConnectionTypeName, type FieldKind } from '@dataflow/core';

export type ConnectionType = TypeRules & {
  /** shown when there is no brand logo, in the group's color */
  icon: LucideIcon;
  /** the product's logo (Simple Icons); Microsoft and AWS logos are not in Simple Icons, so their types use `icon` */
  brand?: SimpleIcon;
};

const LOOKS: Record<ConnectionTypeName, { icon: LucideIcon; brand?: SimpleIcon }> = {
  'rest-basic': { icon: Lock },
  'rest-oauth2': { icon: KeyRound },
  'http-client': { icon: Globe },
  soap: { icon: FileCode },
  s3: { icon: Cloud },
  'azure-blob': { icon: Cloud },
  gcs: { icon: Cloud, brand: siGooglecloudstorage },
  sftp: { icon: FolderSync },
  postgresql: { icon: Database, brand: siPostgresql },
  sqlserver: { icon: Database },
  mysql: { icon: Database, brand: siMysql },
  mongodb: { icon: Leaf, brand: siMongodb },
  redshift: { icon: Warehouse },
  kafka: { icon: Radio, brand: siApachekafka },
  rabbitmq: { icon: Rabbit, brand: siRabbitmq },
  'azure-service-bus': { icon: Send },
  sqs: { icon: Inbox },
};

const COLORS: Record<ConnectionGroup, string> = {
  api: 'var(--category-api)',
  storage: 'var(--category-transformation)',
  database: 'var(--category-database)',
  messaging: 'var(--category-code)',
};

const withLooks = (type: TypeRules): ConnectionType => ({ ...type, ...LOOKS[type.type] });

/** the groups, in the order they are shown, with their color (a CSS variable from index.css) */
export const CONNECTION_GROUPS = GROUPS.map(group => ({ ...group, color: COLORS[group.group] }));

export const CONNECTION_TYPES: ConnectionType[] = TYPES.map(withLooks);

export const connectionType = (type: ConnectionTypeName) => CONNECTION_TYPES.find(t => t.type === type)!;

export const groupColor = (group: ConnectionGroup) => COLORS[group];

/** the types by group (in CONNECTION_GROUPS order); `search` filters by the type's or the group's name */
export const typesByGroup = (search = '') => typesByGroupOf(search).map(group => ({ ...group, types: group.types.map(withLooks) }));
