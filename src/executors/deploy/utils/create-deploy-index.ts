import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	BaseFunctionOptions,
	BuildFunctionData,
	DeployFunction,
	HttpsV1Options,
	HttpsV2Options,
	RuntimeOptions,
	ScheduleOptions,
	TopicOptions,
} from '$types';
/** The name of the default exported function */
const functionStart = 'functionStart';

export const createTemporaryIndexFunctionFile = async (
	buildFunctionData: BuildFunctionData,
): Promise<string> => {
	const code = toDeployIndexCode(buildFunctionData);
	const temporaryFilePath = getTemporaryFilePath(
		buildFunctionData.temporaryDirectory,
		buildFunctionData.functionName,
	);

	await writeFile(temporaryFilePath, code);

	return temporaryFilePath;
};

const getTemporaryFilePath = (
	temporaryDirectory: string,
	functionName: string,
) => join(temporaryDirectory, `${functionName}.ts`);

const toDeployIndexCode = (buildFunctionData: BuildFunctionData) => {
	if ((buildFunctionData as HttpsV2Options).v2) {
		return toDeployV2IndexCode(
			buildFunctionData as BuildFunctionData<'https'>,
		);
	} else {
		return toDeployIndexV1Code(buildFunctionData);
	}
};

const toDeployIndexV1Code = (buildFunctionData: BuildFunctionData) => {
	const { functionName, absolutePath, region } = buildFunctionData;
	const deployableFilePath = absolutePath;
	const pathWithoutSuffix = deployableFilePath.replace('.ts', '');
	const fileCode = `
		import { region } from 'firebase-functions';
		import ${functionStart} from '${pathWithoutSuffix}';
		export const ${functionName} = region('${region}').${getRootFunctionCode(
		buildFunctionData,
	)}.${toEndCode(buildFunctionData)}
	`;

	return fileCode;
};

const toDeployV2IndexCode = (buildFunctionData: BuildFunctionData<'https'>) => {
	const { functionName, absolutePath, deployFunction } = buildFunctionData;

	if (deployFunction !== 'onRequest' && deployFunction !== 'onCall') {
		throw new Error(
			`Invalid deploy function ${deployFunction} for https v2`,
		);
	}

	const deployableFilePath = absolutePath;
	const pathWithoutSuffix = deployableFilePath.replace('.ts', '');
	const fileCode = `
		import { ${deployFunction} } from 'firebase-functions/v2/https';
		import ${functionStart} from '${pathWithoutSuffix}';
		export const ${functionName} = ${deployFunction}(
				(${getV2Options(buildFunctionData as HttpsV2Options)}),
				${functionStart}
			);
	`;

	return fileCode;
};

const getV2Options = (options: HttpsV2Options): string => {
	const optionsCode = toOptionsCode(
		removeAllOtherOptions(options) as { [key: string]: unknown },
	);

	return optionsCode;
};

const getRootFunctionCode = (buildFunctionData: BuildFunctionData): string => {
	const { rootFunctionBuilder } = buildFunctionData;
	const runtimeOptions = (buildFunctionData as HttpsV1Options).runtimeOptions;

	if (!runtimeOptions) {
		return rootFunctionBuilder;
	}

	const runWithCode = getRunWithCode(runtimeOptions);
	return `${runWithCode}.${rootFunctionBuilder}`;
};

const getRunWithCode = (runtimeOptions: RuntimeOptions): string => {
	const optionsCode = toOptionsCode(
		runtimeOptions as { [key: string]: unknown },
	);

	return `runWith(${optionsCode})`;
};

const toEndCode = (deployFileData: BuildFunctionData): string => {
	const { deployFunction, path } = deployFileData;
	const functionCode = toFunctionCodeType(deployFunction);

	switch (deployFunction) {
		case 'onCall':
		case 'onRequest':
			return `${functionCode}(${functionStart});`;
		case 'onCreate':
		case 'onDelete':
		case 'onUpdate':
		case 'onWrite':
			return `document('${path}').${functionCode}(${functionStart});`;
		case 'onRefCreate':
		case 'onRefDelete':
		case 'onRefUpdate':
		case 'onRefWrite':
			return `ref('${path}').${functionCode}(${functionStart});`;

		case 'topic':
			return getTopicDeployCode(deployFileData);
		case 'schedule':
			return getScheduleDeployCode(deployFileData);
		case 'onObjectArchive':
		case 'onObjectDelete':
		case 'onObjectFinalize':
		case 'onObjectMetadataUpdate':
			return `object().${functionCode}(${functionStart});`;

		default:
			throw new Error(`Unknown function type: ${deployFunction}`);
	}
};

const toFunctionCodeType = (deployFunction: DeployFunction): string => {
	switch (deployFunction) {
		case 'onCall':
			return 'onCall';
		case 'onRequest':
			return 'onRequest';
		case 'onCreate':
			return 'onCreate';
		case 'onDelete':
			return 'onDelete';
		case 'onUpdate':
			return 'onUpdate';
		case 'onWrite':
			return 'onWrite';
		case 'topic':
			return 'topic';
		case 'schedule':
			return 'schedule';
		case 'onObjectArchive':
			return 'onArchive';
		case 'onObjectDelete':
			return 'onDelete';
		case 'onObjectFinalize':
			return 'onFinalize';
		case 'onObjectMetadataUpdate':
			return 'onMetadataUpdate';
		case 'onRefCreate':
			return 'onCreate';
		case 'onRefDelete':
			return 'onDelete';
		case 'onRefUpdate':
			return 'onUpdate';
		case 'onRefWrite':
			return 'onWrite';
		default:
			throw new Error(`Unknown function type: ${deployFunction}`);
	}
};

const getScheduleDeployCode = (deployOptions?: BaseFunctionOptions): string => {
	if (!deployOptions) {
		throw new Error('Pubsub deploy options are required');
	}

	const { timeZone, schedule } = deployOptions as ScheduleOptions;
	let pubsubCode = `schedule('${schedule}').`;

	if (timeZone) {
		pubsubCode += `timeZone('${timeZone}').`;
	}

	pubsubCode += `onRun(${functionStart})`;

	return pubsubCode;
};

const getTopicDeployCode = (deployOptions?: BaseFunctionOptions): string => {
	if (!deployOptions) {
		throw new Error('Pubsub deploy options are required');
	}

	const { topic } = deployOptions as TopicOptions;
	let pubsubCode = `topic('${topic}').`;

	pubsubCode += `onRun(${functionStart})`;

	return pubsubCode;
};

const toOptionsCode = (options: { [key: string]: unknown }): string => {
	let optionsCode = '{';
	for (const [key, value] of Object.entries(options)) {
		if (Array.isArray(value)) {
			optionsCode += `'${key}': [${value
				.map((v) => `${typeof v === 'string' ? `'${v}'` : v}`)
				.join(',')}],`;
			continue;
		}

		if (typeof value === 'object') {
			optionsCode += `'${key}': ${toOptionsCode(
				value as { [key: string]: unknown },
			)},`;
			continue;
		}

		if (
			typeof value !== 'string' &&
			typeof value !== 'number' &&
			typeof value !== 'boolean'
		) {
			continue;
		}

		optionsCode += `'${key}': ${
			typeof value === 'string' ? `'${value}'` : value
		},`;
	}
	optionsCode += '}';
	return optionsCode;
};

const removeAllOtherOptions = (
	buildFunctionData: BuildFunctionData | HttpsV2Options,
): Partial<BuildFunctionData> => {
	const options: Partial<BuildFunctionData> & { v2?: boolean } = {
		...buildFunctionData,
		region: buildFunctionData.region as string,
	};

	const keysToDelete: (keyof BuildFunctionData)[] = [
		'absolutePath',
		'alias',
		'assets',
		'checksum',
		'cloudCacheFileName',
		'defaultRegion',
		'deployFunction',
		'dryRun',
		'environmentFileCode',
		'external',
		'firebaseProjectId',
		'flavor',
		'force',
		'functionName',
		'functionsDirectory',
		'only',
		'outputDirectory',
		'outputRoot',
		'packageManager',
		'path',
		'projectRoot',
		'relativeDeployFilePath',
		'rootFunctionBuilder',
		'startTime',
		'temporaryDirectory',
		'tsConfig',
		'validate',
		'workspaceRoot',
	];

	delete options.v2;

	for (const key of keysToDelete) {
		delete options[key];
	}

	return options;
};
