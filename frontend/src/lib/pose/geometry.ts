export interface Point3D {
	x: number;
	y: number;
	z: number;
}

const MIN_LENGTH = 0.00001;
const DEGREES = 180 / Math.PI;

export function jointAngle(first: Point3D, vertex: Point3D, last: Point3D): number | null {
	const ax = first.x - vertex.x;
	const ay = first.y - vertex.y;
	const az = first.z - vertex.z;
	const bx = last.x - vertex.x;
	const by = last.y - vertex.y;
	const bz = last.z - vertex.z;
	const lengthA = Math.hypot(ax, ay, az);
	const lengthB = Math.hypot(bx, by, bz);
	if (!Number.isFinite(lengthA + lengthB) || lengthA < MIN_LENGTH || lengthB < MIN_LENGTH) {
		return null;
	}
	const cosine = (ax * bx + ay * by + az * bz) / (lengthA * lengthB);
	return Math.acos(Math.max(-1, Math.min(1, cosine))) * DEGREES;
}

export function anklePlantarFlexionAngle(
	knee: Point3D,
	ankle: Point3D,
	heel: Point3D,
	toe: Point3D
): number | null {
	const shinX = knee.x - ankle.x;
	const shinY = knee.y - ankle.y;
	const shinZ = knee.z - ankle.z;
	const footX = toe.x - heel.x;
	const footY = toe.y - heel.y;
	const footZ = toe.z - heel.z;
	const shinLength = Math.hypot(shinX, shinY, shinZ);
	const footLength = Math.hypot(footX, footY, footZ);
	if (
		!Number.isFinite(shinLength) || !Number.isFinite(footLength) ||
		shinLength < MIN_LENGTH || footLength < MIN_LENGTH
	) {
		return null;
	}
	const cosine = (shinX / shinLength) * (footX / footLength) +
		(shinY / shinLength) * (footY / footLength) +
		(shinZ / shinLength) * (footZ / footLength);
	return Math.acos(Math.max(-1, Math.min(1, cosine))) * DEGREES - 90;
}

export function hipFlexionAngle(
	shoulder: Point3D,
	hip: Point3D,
	knee: Point3D,
	leftHip: Point3D,
	rightHip: Point3D
): number | null {
	const lateralX = rightHip.x - leftHip.x;
	const lateralY = rightHip.y - leftHip.y;
	const lateralZ = rightHip.z - leftHip.z;
	const lateralLength = Math.hypot(lateralX, lateralY, lateralZ);
	if (!Number.isFinite(lateralLength) || lateralLength < MIN_LENGTH) return null;
	const lx = lateralX / lateralLength;
	const ly = lateralY / lateralLength;
	const lz = lateralZ / lateralLength;
	const torsoX = shoulder.x - hip.x;
	const torsoY = shoulder.y - hip.y;
	const torsoZ = shoulder.z - hip.z;
	const lateralTorso = torsoX * lx + torsoY * ly + torsoZ * lz;
	const upX = torsoX - lateralTorso * lx;
	const upY = torsoY - lateralTorso * ly;
	const upZ = torsoZ - lateralTorso * lz;
	const upLength = Math.hypot(upX, upY, upZ);
	if (!Number.isFinite(upLength) || upLength < MIN_LENGTH) return null;
	const ux = upX / upLength;
	const uy = upY / upLength;
	const uz = upZ / upLength;
	const forwardX = uy * lz - uz * ly;
	const forwardY = uz * lx - ux * lz;
	const forwardZ = ux * ly - uy * lx;
	const thighX = knee.x - hip.x;
	const thighY = knee.y - hip.y;
	const thighZ = knee.z - hip.z;
	const forward = thighX * forwardX + thighY * forwardY + thighZ * forwardZ;
	const down = -(thighX * ux + thighY * uy + thighZ * uz);
	const projectedLength = Math.hypot(forward, down);
	if (!Number.isFinite(projectedLength) || projectedLength < MIN_LENGTH) return null;
	return Math.atan2(forward, down) * DEGREES;
}
