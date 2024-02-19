import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { glob } from 'glob';
import { join } from 'path';
import * as t from 'typanion';

import { ChangelogEntry, addToChangelog } from '../../../core/changelog';
import { IConfiguration } from '../../../core/configuration';
import { DEFAULT_PACKAGE_VERSION } from '../../../core/constants';
import { IProject, IWorkspace } from '../../../core/workspace-utils';
import { IPlugin, IPluginInitialize } from '../..';

export const isGradleBuildFile = t.isPartial({
    version: t.isOptional(t.isString()),
    name: t.isString(),
    private: t.isOptional(t.isBoolean()),
    workspaces: t.isOptional(t.isArray(t.isString())),
});
  
export type GradleManifest = t.InferType<typeof isGradleBuildFile>;
  
export interface GradleManifestContent {
    manifest: GradleManifest;
    eofInEnd: boolean;
}
  
const GRADLE_MANIFEST_NAME = 'build.gradle';
  
export async function loadGradleBuildFile(folder: string): Promise<GradleManifestContent | null> {
    const stringContent = await readFile(join(folder, GRADLE_MANIFEST_NAME), 'utf-8');
    const content = JSON.parse(stringContent);
    const errors: string[] = [];
    if (isGradleBuildFile(content, { errors })) {
        return {
            eofInEnd: stringContent.endsWith('\n'),
            manifest: content,
        };
    }
    return null;
  }
  
  export async function persistGradleBuildFile(folder: string, manifestContent: GradleManifestContent) {
    let stringContent = JSON.stringify(manifestContent.manifest, null, 2);
    if (manifestContent.eofInEnd) {
        stringContent += '\n';
    }
    await writeFile(join(folder, GRADLE_MANIFEST_NAME), stringContent, 'utf-8');
}

export class GradleWorkspace implements IWorkspace {
    protected _project: GradleProject;
    private manifestContent: GradleManifestContent;
  
    get manifest() {
        return this.manifestContent.manifest;
    }
  
    readonly relativeCwd: string;
  
    get cwd() {
        return join(this.project.cwd, this.relativeCwd);
    }
  
    get version() {
        return this.manifest.version ?? DEFAULT_PACKAGE_VERSION;
    }
  
    get private() {
        return this.manifest.private ?? false;
    }
  
    get config() {
        return this.project.config;
    }
  
    get packageName() {
        return this.manifest.name;
    }
  
    get project(): GradleProject {
        return this._project!;
    }
  
    get tagPrefix() {
        if (this.config.options.independentVersioning) {
            return `${this.config.options.versionTagPrefix}${this.packageName}@`;
        } else {
            return this.config.options.versionTagPrefix;
        }
    }
  
    constructor(project: GradleProject, relativeCwd: string, manifestContent: GradleManifestContent) {
        this.manifestContent = manifestContent;
    
        if (!this.manifest.name) {
            throw new Error(`Invalid manifest. Package at '${relativeCwd}' does not have a name`);
        }
        this.relativeCwd = relativeCwd;
        this._project = project;
    }
  
    async updateChangelog(entry: ChangelogEntry) {
        const changeLogFile = join(this.cwd, 'CHANGELOG.md');
        let changeLog = '';
        if (existsSync(changeLogFile)) {
            changeLog = await readFile(changeLogFile, 'utf-8');
        }
        changeLog = addToChangelog(entry, changeLog);
        await writeFile(changeLogFile, changeLog, 'utf-8');
        return changeLogFile;
    }
  
    async updateVersion(version: string) {
        const newManifest: GradleManifest = {
            ...this.manifest,
            version,
        };
        this.manifestContent.manifest = newManifest;
    
        await persistGradleBuildFile(this.cwd, this.manifestContent);
    }
}

export class GradleProject extends GradleWorkspace implements IProject, IPlugin {
    readonly name = 'Gradle project';

    private _cwd: string;
    private _config: IConfiguration;

    get cwd(): any {
        return this._cwd;
    }

    get config(): any {
        return this._config;
    }
    
    childWorkspaces: GradleWorkspace[] = [];

    get workspaces(): GradleWorkspace[] {
        return [
            this,
            ...this.childWorkspaces,
        ];
    }

    get project(): GradleProject {
        return this;
    }

    static async initialize(initialize: IPluginInitialize): Promise<GradleProject | null> {
        const manifestContent = await loadGradleBuildFile(initialize.cwd);
        if (!manifestContent) {
            return null;
        }
    
        const project = new GradleProject(initialize.cwd, manifestContent, initialize);
    
        if (project.manifest.workspaces && Array.isArray(project.manifest.workspaces)) {
            const paths = await glob(project.manifest.workspaces, {
                cwd: initialize.cwd,
            });
        
            const workspacePromises = paths.map(async (path: string) => {
                const worspaceManifestContent = await loadGradleBuildFile(join(initialize.cwd, path));
                if (worspaceManifestContent && worspaceManifestContent.manifest.private !== true) {
                    return new GradleWorkspace(project, path, worspaceManifestContent);
                } else {
                    return undefined;
                }
            });
        
            const workspaces = await Promise.all(workspacePromises);
            project.childWorkspaces = workspaces.filter((workspace: any): workspace is GradleWorkspace => !!workspace);
        }
        return project;
      }
    
      private constructor(cwd: string, manifestContent: GradleManifestContent, config: IConfiguration) {
        super((undefined as any as GradleProject), '.', manifestContent);
        this._project = this;
        this._cwd = cwd;
        this._config = config;
      }
}
