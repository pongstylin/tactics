import decancer from 'decancer';

export default str => typeof str === 'string' ? decancer(str).toString().replace(/ /g, '') : str;
