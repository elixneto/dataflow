import { TEST_TIMEOUT_MS, type ConnectionTest, type ConnectionTestInput } from './connection-test';

export class SqlServerConnectionTest implements ConnectionTest {
  constructor(private readonly timeoutMs = TEST_TIMEOUT_MS) {}

  async test({ config, secrets }: ConnectionTestInput): Promise<string> {
    const { default: sql } = await import('mssql');
    const pool = new sql.ConnectionPool({
      server: config.host ?? '',
      port: Number(config.port),
      database: config.database,
      user: config.user,
      password: secrets.password,
      connectionTimeout: this.timeoutMs,
      requestTimeout: this.timeoutMs,
      pool: { max: 1, min: 0 },
      options: {
        encrypt: config.encrypt !== 'off',
        trustServerCertificate: config.trustServerCertificate === 'on',
        appName: 'dataflow',
      },
    });
    try {
      await pool.connect();
      const result = await pool.request().query<{ version: string }>(`SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version`);
      const version = result.recordset[0]?.version;
      return version ? `SQL Server ${version}` : 'SQL Server';
    } finally {
      await pool.close().catch(() => undefined);
    }
  }
}
