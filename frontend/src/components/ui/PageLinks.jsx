/* Disabled navigation enhancement (user request):
import { Link } from 'react-router-dom';
import './PageLinks.css';

export default function PageLinks({ links, label = 'Related pages' }) {
  return <nav className="calup-page-links" aria-label={label}>
    {links.filter(Boolean).map(link => <Link key={`${link.to}-${link.label}`} to={link.to} state={link.state}>{link.label}</Link>)}
  </nav>;
}

*/
